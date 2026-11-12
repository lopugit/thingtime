use crate::{IndexerError, MAX_RESOURCE_MEMORY_MIB};
use cpu_time::ProcessTime;
use memory_stats::memory_stats;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub(crate) const MIN_RESOURCE_MEMORY_MIB: usize = 32;
pub(crate) const MAX_RESOURCE_THREADS: usize = 64;
pub(crate) const MAX_RESOURCE_PARALLELISM: usize = 64;
pub(crate) const MAX_OPEN_DIRECTORIES: usize = 256;
pub(crate) const MIN_CPU_PERCENT: usize = 1;
pub(crate) const MAX_CPU_PERCENT: usize = 100;

const DEFAULT_MAX_THREADS: usize = 2;
const DEFAULT_MAX_PARALLELISM: usize = 2;
const DEFAULT_MAX_OPEN_DIRECTORIES: usize = 16;
const DEFAULT_MAX_CPU_PERCENT: usize = 60;
const DEFAULT_MAX_MEMORY_MIB: usize = 512;
// Both traversal and writer paths call checkpoint. Process CPU time is cheap to
// sample and needs a responsive feedback loop; resident-memory sampling crosses
// the OS boundary and can be much less frequent because the queue and SQLite
// cache are already bounded. At normal scan rates this checks CPU several times
// a second and RSS roughly once or twice a second.
const CPU_CHECK_STRIDE: usize = 2_048;
const MEMORY_CHECK_STRIDE: usize = 16_384;
const CPU_WINDOW_MINIMUM: Duration = Duration::from_millis(40);
const CPU_WINDOW_RESET: Duration = Duration::from_millis(250);
const MAX_THROTTLE_SLEEP: Duration = Duration::from_millis(250);
// Idle time may fund at most 100 ms of aggregate scan bytes, shared by all
// workers. Useful work and timer oversleep count toward the next reservation.
const SCAN_BURST_WINDOW: Duration = Duration::from_millis(100);

fn scan_deadline(previous: Instant, now: Instant, bytes: usize, rate: f64) -> Instant {
    let earliest = now.checked_sub(SCAN_BURST_WINDOW).unwrap_or(now);
    previous.max(earliest) + Duration::from_secs_f64(bytes as f64 / rate)
}

fn wait_for_scan(
    deadline: Instant,
    cancelled: &AtomicBool,
    now: impl Fn() -> Instant,
    sleep: impl Fn(Duration),
) -> bool {
    loop {
        if cancelled.load(Ordering::Relaxed) { return false; }
        let remaining = deadline.saturating_duration_since(now());
        if remaining.is_zero() { return true; }
        sleep(remaining.min(Duration::from_millis(25)));
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexResourceLimits {
    #[serde(default = "default_max_threads")]
    pub max_threads: usize,
    #[serde(default = "default_max_parallelism")]
    pub max_parallelism: usize,
    #[serde(default = "default_max_open_directories")]
    pub max_open_directories: usize,
    #[serde(default = "default_max_cpu_percent")]
    pub max_cpu_percent: usize,
    #[serde(default = "default_max_memory_mib")]
    #[serde(rename = "maxMemoryMiB")]
    pub max_memory_mib: usize,
}

impl Default for IndexResourceLimits {
    fn default() -> Self {
        Self {
            max_threads: DEFAULT_MAX_THREADS,
            max_parallelism: DEFAULT_MAX_PARALLELISM,
            max_open_directories: DEFAULT_MAX_OPEN_DIRECTORIES,
            max_cpu_percent: DEFAULT_MAX_CPU_PERCENT,
            max_memory_mib: DEFAULT_MAX_MEMORY_MIB,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveResourceLimits {
    pub logical_cpu_count: usize,
    pub worker_threads: usize,
    pub max_open_directories: usize,
    pub max_cpu_percent: usize,
    #[serde(rename = "maxMemoryMiB")]
    pub max_memory_mib: usize,
    pub channel_capacity: usize,
    pub sqlite_cache_kib: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexResourceUsage {
    pub effective: EffectiveResourceLimits,
    pub cpu_time_ms: u64,
    pub cpu_time_nanoseconds: u64,
    pub wall_time_nanoseconds: u64,
    pub average_cpu_percent: usize,
    pub peak_memory_bytes: u64,
    pub throttled_ms: u64,
    pub memory_checks: u64,
    pub active_worker_limit: usize,
    pub cpu_measurement_available: bool,
    pub scan_bytes: u64,
    pub resident_memory_bytes: Option<u64>,
}

pub(crate) struct ResourceGovernor {
    effective: EffectiveResourceLimits,
    cpu_share: usize,
    active_workers: AtomicUsize,
    active_worker_limit: AtomicUsize,
    started_wall: Instant,
    started_cpu: Option<ProcessTime>,
    checkpoints: AtomicUsize,
    peak_memory_bytes: AtomicU64,
    memory_checks: AtomicU64,
    throttled_ns: AtomicU64,
    cancelled: AtomicBool,
    failure: Mutex<Option<String>>,
    cpu_window: Mutex<CpuWindow>,
    scan_budget: Mutex<(Option<f64>, Instant)>,
    scan_bytes: AtomicU64,
}

pub(crate) struct WorkerPermit<'a>(&'a ResourceGovernor);
impl Drop for WorkerPermit<'_> {
    fn drop(&mut self) {
        self.0.active_workers.fetch_sub(1, Ordering::Release);
    }
}

struct CpuWindow {
    wall: Instant,
    cpu: Option<ProcessTime>,
}

impl ResourceGovernor {
    pub(crate) fn new(limits: &IndexResourceLimits) -> Result<Self, IndexerError> {
        Self::new_with_cpu_share(limits, 1)
    }
    pub(crate) fn new_with_cpu_share(
        limits: &IndexResourceLimits,
        cpu_share: usize,
    ) -> Result<Self, IndexerError> {
        validate_resource_limits(limits)?;
        let started_wall = Instant::now();
        let started_cpu = Some(ProcessTime::try_now().map_err(|error| {
            IndexerError::new(
                "resource_unavailable",
                format!("cannot measure indexer CPU usage on this machine: {error}"),
            )
        })?);
        let governor = Self {
            scan_budget: Mutex::new((None, started_wall)),
            scan_bytes: AtomicU64::new(0),
            effective: effective_resource_limits(limits, logical_cpu_count()),
            cpu_share: cpu_share.max(1),
            active_workers: AtomicUsize::new(0),
            active_worker_limit: AtomicUsize::new(
                effective_resource_limits(limits, logical_cpu_count()).worker_threads,
            ),
            started_wall,
            started_cpu,
            checkpoints: AtomicUsize::new(0),
            peak_memory_bytes: AtomicU64::new(0),
            memory_checks: AtomicU64::new(0),
            throttled_ns: AtomicU64::new(0),
            cancelled: AtomicBool::new(false),
            failure: Mutex::new(None),
            cpu_window: Mutex::new(CpuWindow {
                wall: started_wall,
                cpu: started_cpu,
            }),
        };
        governor.sample_memory()?;
        Ok(governor)
    }

    pub(crate) fn record_scan(&self, bytes: usize) { self.scan_bytes.fetch_add(bytes as u64, Ordering::Relaxed); }
    pub(crate) fn set_scan_rate(&self, rate: Option<f64>) {
        self.scan_budget.lock().unwrap().0 = rate;
    }
    pub(crate) fn pace_scan(&self, count: usize, cancelled: &AtomicBool) -> Result<(), IndexerError> {
        let mut remaining = count;
        while remaining > 0 {
            if cancelled.load(Ordering::Relaxed) { return Err(self.failure_error()); }
            let mut gate = self.scan_budget.lock().unwrap();
            let Some(rate) = gate.0 else { return Ok(()); };
            let part = remaining.min((rate / 10.0).max(1.0) as usize);
            // Reserve under the shared lock before sleeping. Keeping the previous
            // deadline (rather than restarting at now) credits hashing, metadata
            // work and scheduling delays without granting unbounded idle credit.
            let deadline = scan_deadline(gate.1, Instant::now(), part, rate);
            gate.1 = deadline;
            drop(gate);
            if !wait_for_scan(deadline, cancelled, Instant::now, std::thread::sleep) {
                return Err(self.failure_error());
            }
            remaining -= part;
        }
        Ok(())
    }
    pub(crate) fn effective(&self) -> &EffectiveResourceLimits {
        &self.effective
    }

    pub(crate) fn checkpoint(&self) -> Result<(), IndexerError> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(self.failure_error());
        }
        let checkpoint = self.checkpoints.fetch_add(1, Ordering::Relaxed) + 1;
        if checkpoint % MEMORY_CHECK_STRIDE == 0 {
            self.sample_memory()?;
        }
        if checkpoint % CPU_CHECK_STRIDE == 0 {
            self.throttle_cpu();
        }
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(self.failure_error());
        }
        Ok(())
    }

    /// Each directory/file observation holds one eligible worker slot. CPU
    /// feedback lowers this gate without spawning a second traversal pool.
    pub(crate) fn admit(&self) -> Result<WorkerPermit<'_>, IndexerError> {
        loop {
            self.checkpoint()?;
            self.throttle_cpu();
            let active = self.active_workers.load(Ordering::Relaxed);
            if active < self.active_worker_limit.load(Ordering::Relaxed)
                && self
                    .active_workers
                    .compare_exchange(active, active + 1, Ordering::AcqRel, Ordering::Relaxed)
                    .is_ok()
            {
                return Ok(WorkerPermit(self));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    pub(crate) fn check_memory_now(&self) -> Result<(), IndexerError> {
        self.sample_memory()
    }

    pub(crate) fn finish(&self) -> IndexResourceUsage {
        self.enforce_total_cpu_average();
        self.snapshot()
    }

    pub(crate) fn snapshot(&self) -> IndexResourceUsage {
        let elapsed = self.started_wall.elapsed();
        let measured_cpu = self.started_cpu.and_then(|started| {
            ProcessTime::try_now()
                .ok()
                .map(|now| now.duration_since(started))
        });
        let cpu_time = measured_cpu.unwrap_or_default();
        let average_cpu_percent =
            average_cpu_percent(cpu_time, elapsed, self.effective.logical_cpu_count);
        IndexResourceUsage {
            effective: self.effective.clone(),
            scan_bytes: self.scan_bytes.load(Ordering::Relaxed),
            resident_memory_bytes: memory_stats().and_then(|stats| u64::try_from(stats.physical_mem).ok()),
            cpu_time_ms: duration_ms(cpu_time),
            cpu_time_nanoseconds: u64::try_from(cpu_time.as_nanos()).unwrap_or(u64::MAX),
            wall_time_nanoseconds: u64::try_from(elapsed.as_nanos()).unwrap_or(u64::MAX),
            average_cpu_percent,
            peak_memory_bytes: self.peak_memory_bytes.load(Ordering::Relaxed),
            throttled_ms: nanos_to_millis(self.throttled_ns.load(Ordering::Relaxed)),
            memory_checks: self.memory_checks.load(Ordering::Relaxed),
            active_worker_limit: self.active_worker_limit.load(Ordering::Relaxed),
            cpu_measurement_available: measured_cpu.is_some(),
        }
    }

    fn sample_memory(&self) -> Result<(), IndexerError> {
        let stats = memory_stats().ok_or_else(|| {
            IndexerError::new(
                "resource_unavailable",
                "cannot measure indexer resident memory on this machine",
            )
        })?;
        self.memory_checks.fetch_add(1, Ordering::Relaxed);
        let resident = u64::try_from(stats.physical_mem).unwrap_or(u64::MAX);
        self.peak_memory_bytes
            .fetch_max(resident, Ordering::Relaxed);
        let limit = u64::try_from(self.effective.max_memory_mib)
            .unwrap_or(u64::MAX)
            .saturating_mul(1024 * 1024);
        if resident <= limit {
            return Ok(());
        }
        let message = format!(
            "indexer memory limit exceeded: {} MiB resident is above the configured {} MiB limit; the previous index was preserved",
            resident.div_ceil(1024 * 1024),
            self.effective.max_memory_mib
        );
        self.cancelled.store(true, Ordering::Relaxed);
        *self
            .failure
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(message.clone());
        Err(IndexerError::new("resource_limit", message))
    }

    fn throttle_cpu(&self) {
        let mut window = self
            .cpu_window
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now_wall = Instant::now();
        let wall_elapsed = now_wall.duration_since(window.wall);
        if wall_elapsed < CPU_WINDOW_MINIMUM {
            return;
        }
        let Some(started_cpu) = window.cpu else {
            window.wall = now_wall;
            window.cpu = ProcessTime::try_now().ok();
            return;
        };
        let Ok(now_cpu) = ProcessTime::try_now() else {
            window.wall = now_wall;
            window.cpu = None;
            return;
        };
        let cpu_elapsed = now_cpu.duration_since(started_cpu);
        let percent = cpu_elapsed.as_secs_f64()
            / wall_elapsed.as_secs_f64()
            / self.effective.logical_cpu_count as f64
            * 100.0;
        let limit = self.active_worker_limit.load(Ordering::Relaxed);
        if percent * self.cpu_share as f64 > self.effective.max_cpu_percent as f64 {
            self.active_worker_limit
                .store(limit.saturating_sub(1).max(1), Ordering::Relaxed);
        } else if percent * self.cpu_share as f64 * 5.0
            < self.effective.max_cpu_percent as f64 * 4.0
            && wall_elapsed >= CPU_WINDOW_RESET
        {
            self.active_worker_limit.store(
                (limit + 1).min(self.effective.worker_threads),
                Ordering::Relaxed,
            );
        }
        let sleep_for = cpu_throttle_delay(
            cpu_elapsed,
            wall_elapsed,
            self.effective.logical_cpu_count,
            self.effective.max_cpu_percent as f64 / self.cpu_share as f64,
        )
        .min(MAX_THROTTLE_SLEEP);
        if !sleep_for.is_zero() {
            // Holding the gate pauses every worker at its next checkpoint and
            // makes the limit process-wide instead of multiplying it by the
            // number of traversal threads.
            std::thread::sleep(sleep_for);
            self.throttled_ns.fetch_add(
                u64::try_from(sleep_for.as_nanos()).unwrap_or(u64::MAX),
                Ordering::Relaxed,
            );
            window.wall = Instant::now();
            window.cpu = ProcessTime::try_now().ok();
        } else if wall_elapsed >= CPU_WINDOW_RESET {
            window.wall = now_wall;
            window.cpu = Some(now_cpu);
        }
    }

    fn enforce_total_cpu_average(&self) {
        let Some(started_cpu) = self.started_cpu else {
            return;
        };
        let Ok(now_cpu) = ProcessTime::try_now() else {
            return;
        };
        let sleep_for = cpu_throttle_delay(
            now_cpu.duration_since(started_cpu),
            self.started_wall.elapsed(),
            self.effective.logical_cpu_count,
            self.effective.max_cpu_percent as f64 / self.cpu_share as f64,
        );
        if sleep_for.is_zero() {
            return;
        }
        std::thread::sleep(sleep_for);
        self.throttled_ns.fetch_add(
            u64::try_from(sleep_for.as_nanos()).unwrap_or(u64::MAX),
            Ordering::Relaxed,
        );
    }

    fn failure_error(&self) -> IndexerError {
        let message = self
            .failure
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .unwrap_or_else(|| {
                "filesystem indexing was cancelled by its resource governor".to_owned()
            });
        IndexerError::new("resource_limit", message)
    }
}

pub(crate) fn validate_resource_limits(limits: &IndexResourceLimits) -> Result<(), IndexerError> {
    validate_range("maxThreads", limits.max_threads, 1, MAX_RESOURCE_THREADS)?;
    validate_range(
        "maxParallelism",
        limits.max_parallelism,
        1,
        MAX_RESOURCE_PARALLELISM,
    )?;
    validate_range(
        "maxOpenDirectories",
        limits.max_open_directories,
        1,
        MAX_OPEN_DIRECTORIES,
    )?;
    validate_range(
        "maxCpuPercent",
        limits.max_cpu_percent,
        MIN_CPU_PERCENT,
        MAX_CPU_PERCENT,
    )?;
    validate_range(
        "maxMemoryMiB",
        limits.max_memory_mib,
        MIN_RESOURCE_MEMORY_MIB,
        MAX_RESOURCE_MEMORY_MIB,
    )?;
    Ok(())
}

fn validate_range(
    name: &str,
    value: usize,
    minimum: usize,
    maximum: usize,
) -> Result<(), IndexerError> {
    if (minimum..=maximum).contains(&value) {
        return Ok(());
    }
    Err(IndexerError::new(
        "invalid_configuration",
        format!("{name} must be between {minimum} and {maximum}"),
    ))
}

fn effective_resource_limits(
    limits: &IndexResourceLimits,
    logical_cpus: usize,
) -> EffectiveResourceLimits {
    let logical_cpus = logical_cpus.max(1);
    // These are ceilings, not a requirement to populate every worker. Search
    // indexing streams bounded-depth chunks with one producer; backup capture
    // may use the permitted pool. Both respect the directory-handle ceiling.
    let worker_threads = limits
        .max_threads
        .min(limits.max_parallelism)
        .min(limits.max_open_directories)
        .min(logical_cpus)
        .max(1);
    let channel_capacity = limits.max_memory_mib.saturating_mul(4).clamp(64, 4_096);
    let sqlite_cache_kib = limits
        .max_memory_mib
        .saturating_mul(1024)
        .saturating_div(4)
        .clamp(2_048, 65_536);
    EffectiveResourceLimits {
        logical_cpu_count: logical_cpus,
        worker_threads,
        max_open_directories: limits.max_open_directories,
        max_cpu_percent: limits.max_cpu_percent,
        max_memory_mib: limits.max_memory_mib,
        channel_capacity,
        sqlite_cache_kib,
    }
}

fn cpu_throttle_delay(
    cpu_elapsed: Duration,
    wall_elapsed: Duration,
    logical_cpus: usize,
    max_cpu_percent: f64,
) -> Duration {
    if wall_elapsed.is_zero() || logical_cpus == 0 || max_cpu_percent == 0.0 {
        return Duration::ZERO;
    }
    let capacity = logical_cpus as f64 * max_cpu_percent / 100.0;
    let allowed_cpu_seconds = wall_elapsed.as_secs_f64() * capacity;
    let excess_cpu_seconds = cpu_elapsed.as_secs_f64() - allowed_cpu_seconds;
    if excess_cpu_seconds <= 0.0 {
        Duration::ZERO
    } else {
        Duration::from_secs_f64(excess_cpu_seconds / capacity)
    }
}

fn average_cpu_percent(
    cpu_elapsed: Duration,
    wall_elapsed: Duration,
    logical_cpus: usize,
) -> usize {
    if wall_elapsed.is_zero() || logical_cpus == 0 {
        return 0;
    }
    ((cpu_elapsed.as_secs_f64() / wall_elapsed.as_secs_f64() / logical_cpus as f64 * 100.0).round()
        as usize)
        .min(100)
}

fn logical_cpu_count() -> usize {
    std::thread::available_parallelism().map_or(1, std::num::NonZeroUsize::get)
}

fn duration_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn nanos_to_millis(nanoseconds: u64) -> u64 {
    nanoseconds / 1_000_000
}

const fn default_max_threads() -> usize {
    DEFAULT_MAX_THREADS
}

const fn default_max_parallelism() -> usize {
    DEFAULT_MAX_PARALLELISM
}

const fn default_max_open_directories() -> usize {
    DEFAULT_MAX_OPEN_DIRECTORIES
}

const fn default_max_cpu_percent() -> usize {
    DEFAULT_MAX_CPU_PERCENT
}

const fn default_max_memory_mib() -> usize {
    DEFAULT_MAX_MEMORY_MIB
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_workers_obey_every_concurrency_ceiling() {
        let limits = IndexResourceLimits {
            max_threads: 12,
            max_parallelism: 5,
            max_open_directories: 3,
            max_cpu_percent: 80,
            max_memory_mib: 256,
        };
        let effective = effective_resource_limits(&limits, 16);
        assert_eq!(effective.worker_threads, 3);
        assert_eq!(effective.max_open_directories, 3);
        assert!(effective.channel_capacity <= 4_096);
        assert!(effective.sqlite_cache_kib <= 65_536);
    }

    #[test]
    fn cpu_delay_accounts_for_total_machine_capacity() {
        assert_eq!(
            cpu_throttle_delay(
                Duration::from_millis(300),
                Duration::from_millis(100),
                4,
                50.0,
            ),
            Duration::from_millis(50)
        );
        assert_eq!(
            cpu_throttle_delay(
                Duration::from_millis(150),
                Duration::from_millis(100),
                4,
                50.0,
            ),
            Duration::ZERO
        );
    }

    #[test]
    fn invalid_resource_limits_fail_closed() {
        let invalid = IndexResourceLimits {
            max_threads: 0,
            ..IndexResourceLimits::default()
        };
        let error = validate_resource_limits(&invalid).expect_err("zero threads must fail");
        assert_eq!(error.code, "invalid_configuration");
        assert!(error.message.contains("maxThreads"));
    }
}

#[cfg(test)]
mod sync_scan_budget_tests {
    use super::*;
    #[test]
    fn useful_work_and_oversleep_pay_for_the_next_scan_chunk() {
        let start = Instant::now();
        let first = scan_deadline(start, start, 100, 1000.0);
        assert_eq!(first.duration_since(start), Duration::from_millis(100));
        // Hashing/metadata took 40 ms after the first reservation completed.
        let second_now = first + Duration::from_millis(40);
        let second = scan_deadline(first, second_now, 100, 1000.0);
        assert_eq!(second.duration_since(second_now), Duration::from_millis(60));
        // Slow work or an oversleep larger than a chunk needs no further wait.
        let slow_now = second + Duration::from_millis(150);
        assert!(scan_deadline(second, slow_now, 100, 1000.0) <= slow_now);
    }

    #[test]
    fn concurrent_reservations_share_one_rate_and_bounded_idle_credit() {
        let start = Instant::now();
        let now = start + Duration::from_secs(60);
        let mut deadline = start;
        // Simultaneous callers serialize their reservations under scan_budget.
        // A minute idle grants only 100 bytes at 1000 B/s, never a minute's bytes.
        for caller in 1..=20 {
            deadline = scan_deadline(deadline, now, 10, 1000.0);
            let allowed = Duration::from_millis((caller * 10) as u64);
            assert_eq!(deadline, now - SCAN_BURST_WINDOW + allowed);
        }
        assert_eq!(deadline.duration_since(now), SCAN_BURST_WINDOW);
        // Changing rate cannot discard already-reserved concurrent work.
        assert_eq!(scan_deadline(deadline, now, 20, 2000.0),
            deadline + Duration::from_millis(10));
    }

    #[test]
    fn tiny_reads_with_processing_obey_the_aggregate_byte_envelope() {
        let start = Instant::now();
        let mut now = start + Duration::from_secs(60);
        let measurement_start = now;
        let mut deadline = start;
        for reads in 1..=1000_u128 {
            deadline = scan_deadline(deadline, now, 4, 1000.0);
            now = now.max(deadline); // fake sleep until this reservation is due
            let elapsed = now.duration_since(measurement_start).as_nanos();
            let budget_time = elapsed + SCAN_BURST_WINDOW.as_nanos();
            assert!(reads * 4 * 1_000_000_000 <= 1000 * budget_time);
            // Alternate fast and slower metadata/hash work. Unlike the old
            // schedule, this elapsed work pays down the next reservation.
            now += Duration::from_micros(if reads % 7 == 0 { 9000 } else { 1000 });
        }
    }

    #[test]
    fn fake_clock_wait_counts_oversleep_and_checks_cancellation() {
        use std::cell::Cell;
        let start = Instant::now();
        let clock = Cell::new(start);
        let cancelled = AtomicBool::new(false);
        let sleeps = Cell::new(0);
        assert!(wait_for_scan(start + Duration::from_millis(10), &cancelled,
            || clock.get(), |delay| {
                assert_eq!(delay, Duration::from_millis(10));
                sleeps.set(sleeps.get() + 1);
                clock.set(clock.get() + delay + Duration::from_millis(50));
            }));
        assert_eq!(sleeps.get(), 1);
        assert!(!wait_for_scan(clock.get() + Duration::from_secs(1), &cancelled,
            || clock.get(), |delay| {
                assert_eq!(delay, Duration::from_millis(25));
                clock.set(clock.get() + delay);
                cancelled.store(true, Ordering::Relaxed);
            }));
        // Even an already-due reservation refuses cancellation before reading.
        assert!(!wait_for_scan(start, &cancelled, || clock.get(), |_| panic!("no sleep")));
    }

    #[test]
    fn backup_scan_rate_is_shared_between_workers_and_cancellable() {
        let governor = ResourceGovernor::new(&IndexResourceLimits::default()).unwrap();
        governor.set_scan_rate(Some(1000.0));
        let started = Instant::now();
        // Anchor the initial schedule after setup: constructing the governor
        // samples memory and may legitimately earn useful-work credit.
        governor.scan_budget.lock().unwrap().1 = started;
        std::thread::scope(|scope| {
            for _ in 0..2 { let g = &governor; scope.spawn(move || g.pace_scan(100, &AtomicBool::new(false)).unwrap()); }
        });
        assert!(started.elapsed() >= Duration::from_millis(190));
        assert!(governor.pace_scan(100, &AtomicBool::new(true)).is_err());
        governor.record_scan(200); assert_eq!(governor.snapshot().scan_bytes, 200);
    }
}
