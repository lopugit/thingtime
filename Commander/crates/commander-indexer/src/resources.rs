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
pub(crate) const MIN_CPU_PERCENT: usize = 5;
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
    pub average_cpu_percent: usize,
    pub peak_memory_bytes: u64,
    pub throttled_ms: u64,
    pub memory_checks: u64,
}

pub(crate) struct ResourceGovernor {
    effective: EffectiveResourceLimits,
    started_wall: Instant,
    started_cpu: Option<ProcessTime>,
    checkpoints: AtomicUsize,
    peak_memory_bytes: AtomicU64,
    memory_checks: AtomicU64,
    throttled_ns: AtomicU64,
    cancelled: AtomicBool,
    failure: Mutex<Option<String>>,
    cpu_window: Mutex<CpuWindow>,
}

struct CpuWindow {
    wall: Instant,
    cpu: Option<ProcessTime>,
}

impl ResourceGovernor {
    pub(crate) fn new(limits: &IndexResourceLimits) -> Result<Self, IndexerError> {
        validate_resource_limits(limits)?;
        let started_wall = Instant::now();
        let started_cpu = Some(ProcessTime::try_now().map_err(|error| {
            IndexerError::new(
                "resource_unavailable",
                format!("cannot measure indexer CPU usage on this machine: {error}"),
            )
        })?);
        let governor = Self {
            effective: effective_resource_limits(limits, logical_cpu_count()),
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

    pub(crate) fn check_memory_now(&self) -> Result<(), IndexerError> {
        self.sample_memory()
    }

    pub(crate) fn finish(&self) -> IndexResourceUsage {
        self.enforce_total_cpu_average();
        let elapsed = self.started_wall.elapsed();
        let cpu_time = self
            .started_cpu
            .and_then(|started| {
                ProcessTime::try_now()
                    .ok()
                    .map(|now| now.duration_since(started))
            })
            .unwrap_or_default();
        let average_cpu_percent =
            average_cpu_percent(cpu_time, elapsed, self.effective.logical_cpu_count);
        IndexResourceUsage {
            effective: self.effective.clone(),
            cpu_time_ms: duration_ms(cpu_time),
            average_cpu_percent,
            peak_memory_bytes: self.peak_memory_bytes.load(Ordering::Relaxed),
            throttled_ms: nanos_to_millis(self.throttled_ns.load(Ordering::Relaxed)),
            memory_checks: self.memory_checks.load(Ordering::Relaxed),
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
        let sleep_for = cpu_throttle_delay(
            cpu_elapsed,
            wall_elapsed,
            self.effective.logical_cpu_count,
            self.effective.max_cpu_percent,
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
            self.effective.max_cpu_percent,
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
    // ignore 0.4.25 is pinned. Its parallel worker exhausts one ReadDir before
    // opening the next, so one active worker owns at most one directory handle.
    // Taking the strictest of these limits therefore enforces every ceiling.
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
    max_cpu_percent: usize,
) -> Duration {
    if wall_elapsed.is_zero() || logical_cpus == 0 || max_cpu_percent == 0 {
        return Duration::ZERO;
    }
    let capacity = logical_cpus as f64 * max_cpu_percent as f64 / 100.0;
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
                50,
            ),
            Duration::from_millis(50)
        );
        assert_eq!(
            cpu_throttle_delay(
                Duration::from_millis(150),
                Duration::from_millis(100),
                4,
                50,
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
