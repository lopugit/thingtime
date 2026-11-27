//! Streaming backup adapter for the same bounded parallel walker used by search.
//! Candidate paths are untrusted: all content reads reopen each component from
//! a pinned root descriptor with NOFOLLOW, and recheck identity after hashing.
//! The host owns grants, authorization, collision handling and capture sealing.

use crate::backup_ignore::BackupIgnoreRules;
use crate::{
    resources::ResourceGovernor, source_walker, IndexKind, IndexResourceLimits, IndexSource,
    IndexerError,
};
use ignore::WalkState;
use rustix::fs::{open, openat, readlinkat, statat, AtFlags, FileType, Mode, OFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{File, Metadata};
use std::io::{BufRead, BufWriter, Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::Duration;
use unicode_normalization::UnicodeNormalization;
pub mod inventory;
mod live_children;
mod native_receipts;
mod streaming;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    #[serde(default)]
    pub streaming: bool,
    pub root: PathBuf,
    pub root_identity: String,
    #[serde(default)]
    pub excluded_paths: Vec<String>,
    #[serde(default)]
    pub ignore_rules: Option<String>,
    #[serde(default)]
    pub resource_limits: IndexResourceLimits,
    #[serde(default)]
    pub resource_feedback: bool,
    #[serde(default = "default_cpu_shares")]
    pub cpu_budget_shares: usize,
    #[serde(default)]
    pub scan_bytes_per_second: Option<f64>,
}

fn default_cpu_shares() -> usize {
    1
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    algorithm: &'static str,
    part_size_bytes: u64,
    part_count: u64,
    sha256: String,
}

#[derive(Debug, Serialize)]
pub struct Entry {
    path: String,
    id: String,
    version: String,
    kind: &'static str,
    size: u64,
    sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fingerprint: Option<Fingerprint>,
    #[serde(rename = "symbolicLink", skip_serializing_if = "Option::is_none")]
    symbolic_link: Option<SymbolicLink>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolicLink {
    format: &'static str,
    target_base64: String,
}
fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::new();
    for chunk in bytes.chunks(3) {
        let n = ((chunk[0] as u32) << 16)
            | ((chunk.get(1).copied().unwrap_or(0) as u32) << 8)
            | chunk.get(2).copied().unwrap_or(0) as u32;
        output.push(TABLE[((n >> 18) & 63) as usize] as char);
        output.push(TABLE[((n >> 12) & 63) as usize] as char);
        output.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            TABLE[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    output
}

#[derive(Debug, Serialize)]
pub struct Gap {
    path: Option<String>,
    reason: &'static str,
    scope: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "lowercase")]
pub enum Event {
    Hello {
        version: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        streaming: Option<bool>,
    },
    Entry {
        entry: Entry,
    },
    Skipped {
        gap: Gap,
    },
    Ignored,
    Indexed,
    Resources {
        usage: crate::resources::IndexResourceUsage,
    },
    Complete,
}

#[derive(Clone)]
struct EventSender {
    inner: mpsc::SyncSender<Event>,
    sequence: Arc<AtomicU64>,
}
impl EventSender {
    fn send(&self, event: Event) -> Result<(), mpsc::SendError<Event>> {
        if matches!(event, Event::Entry { .. } | Event::Skipped { .. }) {
            self.sequence.fetch_add(1, Ordering::SeqCst);
        }
        self.inner.send(event)
    }
}
#[derive(Default)]
struct WatchControl {
    requested: Mutex<Option<u64>>,
    disconnected: AtomicBool,
}

fn failure(code: &'static str) -> IndexerError {
    IndexerError::new(code, "Backup indexing could not complete.")
}
fn identity(m: &Metadata) -> String {
    format!("{}:{}", m.dev(), m.ino())
}
pub(crate) fn stamp(m: &Metadata) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}",
        m.dev(),
        m.ino(),
        m.size(),
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec()
    )
}
fn key(path: &str) -> String {
    path.nfc().collect::<String>().to_lowercase()
}
fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && path.encode_utf16().count() <= 4096
        && !path.contains('\\')
        && !path.chars().any(|c| c.is_control())
        && path.split('/').count() <= 128
        && path
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != ".." && p.encode_utf16().count() <= 255)
}
fn gap(path: Option<&str>, reason: &'static str, scope: &'static str) -> Event {
    Event::Skipped {
        gap: Gap {
            path: path.map(str::to_owned),
            reason,
            scope,
        },
    }
}
fn io_reason(e: rustix::io::Errno) -> &'static str {
    if e == rustix::io::Errno::NOENT
        || e == rustix::io::Errno::LOOP
        || e == rustix::io::Errno::NOTDIR
    {
        "changed"
    } else {
        "unreadable"
    }
}

/// Never open a special file or follow a link, including in any ancestor.
pub(crate) fn open_path(root: &File, path: &str) -> Result<File, &'static str> {
    let mut parent = root.try_clone().map_err(|_| "unreadable")?;
    let mut parts = path.split('/').peekable();
    while let Some(name) = parts.next() {
        let before = statat(&parent, name, AtFlags::SYMLINK_NOFOLLOW).map_err(io_reason)?;
        let kind = FileType::from_raw_mode(before.st_mode);
        match kind {
            FileType::Symlink => return Err("symlink"),
            FileType::Fifo => return Err("fifo"),
            FileType::Socket => return Err("socket"),
            FileType::CharacterDevice | FileType::BlockDevice => return Err("device"),
            FileType::RegularFile | FileType::Directory => (),
            _ => return Err("special"),
        }
        let mut flags = OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW | OFlags::NONBLOCK;
        if parts.peek().is_some() {
            flags |= OFlags::DIRECTORY;
        }
        let file = File::from(openat(&parent, name, flags, Mode::empty()).map_err(io_reason)?);
        let after = file.metadata().map_err(|_| "unreadable")?;
        if after.dev() != before.st_dev as u64
            || after.ino() != before.st_ino as u64
            || (kind == FileType::Directory) != after.is_dir()
            || (kind == FileType::RegularFile) != after.is_file()
        {
            return Err("changed");
        }
        parent = file;
    }
    Ok(parent)
}

#[cfg(test)]
fn observe(
    root: &File,
    path: &str,
    governor: &ResourceGovernor,
    cancelled: &AtomicBool,
) -> Result<Entry, &'static str> {
    observe_cached(root, path, governor, cancelled, None, None)
}

fn observe_projected(
    root: &File,
    path: &str,
    governor: &ResourceGovernor,
    cancelled: &AtomicBool,
    cache: Option<&inventory::Cache>,
    mount: Option<&str>,
    receipts: Option<&native_receipts::Receipts>,
) -> Result<Option<Entry>, &'static str> {
    if let Some(receipts) = receipts {
        let projection = receipts.inspect(root, path, governor, cancelled)?;
        if !matches!(projection, native_receipts::Projection::Raw)
            && mount.is_some()
            && inventory::mount_identity(&open_path(root, path)?).as_deref() != mount
        {
            return Err("mount_changed");
        }
        match projection {
            native_receipts::Projection::Skip => return Ok(None),
            native_receipts::Projection::Link(entry) => return Ok(Some(entry)),
            native_receipts::Projection::Raw => (),
        }
    }
    observe_cached(root, path, governor, cancelled, cache, mount).map(Some)
}

fn open_link(parent: &File, name: &str) -> Result<File, &'static str> {
    #[cfg(target_vendor = "apple")]
    let flags = OFlags::RDONLY | OFlags::CLOEXEC | OFlags::from_bits_retain(0x00200000) /* Darwin O_SYMLINK pins the link inode */;
    #[cfg(not(target_vendor = "apple"))]
    let flags = OFlags::PATH | OFlags::CLOEXEC | OFlags::NOFOLLOW;
    Ok(File::from(
        openat(parent, name, flags, Mode::empty()).map_err(io_reason)?,
    ))
}

fn metadata_version(root: &File, path: &str) -> Result<String, &'static str> {
    let file = open_metadata_entry(root, path)?;
    Ok(stamp(&file.metadata().map_err(|_| "unreadable")?))
}

fn open_metadata_entry(root: &File, path: &str) -> Result<File, &'static str> {
    match open_path(root, path) {
        Ok(file) => Ok(file),
        Err("symlink") => {
            let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
            let directory = if parent.is_empty() {
                root.try_clone().map_err(|_| "unreadable")?
            } else {
                open_path(root, parent)?
            };
            let before = statat(&directory, name, AtFlags::SYMLINK_NOFOLLOW).map_err(io_reason)?;
            if FileType::from_raw_mode(before.st_mode) != FileType::Symlink {
                return Err("changed");
            }
            let link = open_link(&directory, name)?;
            let metadata = link.metadata().map_err(|_| "unreadable")?;
            if !metadata.is_symlink()
                || before.st_dev as u64 != metadata.dev()
                || before.st_ino as u64 != metadata.ino()
            {
                return Err("changed");
            }
            Ok(link)
        }
        Err(reason) => Err(reason),
    }
}

fn observe_cached(
    root: &File,
    path: &str,
    governor: &ResourceGovernor,
    cancelled: &AtomicBool,
    cache: Option<&inventory::Cache>,
    expected_mount: Option<&str>,
) -> Result<Entry, &'static str> {
    // Resolve ancestors only as directories, then read the final link itself.
    let (parent_path, name) = path.rsplit_once('/').unwrap_or(("", path));
    let parent = if parent_path.is_empty() {
        root.try_clone().map_err(|_| "unreadable")?
    } else {
        open_path(root, parent_path)?
    };
    let initial = statat(&parent, name, AtFlags::SYMLINK_NOFOLLOW).map_err(io_reason)?;
    if FileType::from_raw_mode(initial.st_mode) == FileType::Symlink {
        let link = open_link(&parent, name)?;
        let before = link.metadata().map_err(|_| "unreadable")?;
        if before.dev() != initial.st_dev as u64
            || before.ino() != initial.st_ino as u64
            || !before.file_type().is_symlink()
        {
            return Err("changed");
        }
        let target = readlinkat(&parent, name, Vec::new()).map_err(io_reason)?;
        let bytes = target.as_bytes();
        if bytes.is_empty() || bytes.contains(&0) {
            return Err("special");
        }
        let after = statat(&parent, name, AtFlags::SYMLINK_NOFOLLOW).map_err(io_reason)?;
        if after.st_dev != initial.st_dev
            || after.st_ino != initial.st_ino
            || stamp(&before) != stamp(&link.metadata().map_err(|_| "unreadable")?)
            || readlinkat(&parent, name, Vec::new())
                .map_err(io_reason)?
                .as_bytes()
                != bytes
        {
            return Err("changed");
        }
        governor
            .pace_scan(bytes.len(), cancelled)
            .map_err(|_| "cancelled")?;
        governor.record_scan(bytes.len());
        return Ok(Entry {
            path: path.to_owned(),
            id: identity(&before),
            version: stamp(&before),
            kind: "file",
            size: bytes.len() as u64,
            sha256: None,
            fingerprint: Some(Fingerprint {
                algorithm: "sha256-parts-v1",
                part_size_bytes: 8_388_608,
                part_count: 1,
                sha256: format!("{:x}", Sha256::digest(Sha256::digest(bytes))),
            }),
            symbolic_link: Some(SymbolicLink {
                format: "posix-symlink-v1",
                target_base64: base64(bytes),
            }),
        });
    }
    let mut file = open_path(root, path)?;
    let before = file.metadata().map_err(|_| "unreadable")?;
    let version = stamp(&before);
    let mount = (cache.is_some() || expected_mount.is_some())
        .then(|| inventory::mount_identity(&file))
        .flatten();
    if expected_mount.is_some() && mount.as_deref() != expected_mount {
        return Err("mount_changed");
    }
    let cache = cache.filter(|_| inventory::has_precise_stamps(&file));
    let size = if before.is_dir() { 0 } else { before.size() };
    if size > 9_007_199_254_740_991 {
        return Err("special");
    }
    let mut fingerprint = None;
    let mut cache_miss = false;
    let sha256 = if before.is_file() && size == 0 {
        Some(format!("{:x}", Sha256::digest([])))
    } else {
        None
    };
    if before.is_file() && size > 0 {
        let mib = 1_048_576;
        let part_size = (8 * mib).max(size.div_ceil(10_000)).div_ceil(mib) * mib;
        let cached = cache
            .zip(mount.as_deref())
            .and_then(|(cache, mount)| cache.get(mount, &version));
        cache_miss = cached.is_none();
        let digest = if let Some(digest) = cached {
            digest
        } else {
            let mut composite = Sha256::new();
            let mut part = Sha256::new();
            let mut offset = 0;
            let mut in_part = 0;
            let mut buffer = [0_u8; 65_536];
            while offset < size {
                if cancelled.load(Ordering::Relaxed) || governor.checkpoint().is_err() {
                    return Err("cancelled");
                }
                let wanted = (buffer.len() as u64)
                    .min(size - offset)
                    .min(part_size - in_part) as usize;
                governor
                    .pace_scan(wanted, cancelled)
                    .map_err(|_| "cancelled")?;
                let n = file.read(&mut buffer[..wanted]).map_err(|_| "unreadable")?;
                if n == 0 {
                    return Err("changed");
                }
                governor.record_scan(n);
                part.update(&buffer[..n]);
                offset += n as u64;
                in_part += n as u64;
                if in_part == part_size || offset == size {
                    composite.update(part.finalize_reset());
                    in_part = 0;
                }
            }
            format!("{:x}", composite.finalize())
        };
        fingerprint = Some(Fingerprint {
            algorithm: "sha256-parts-v1",
            part_size_bytes: part_size,
            part_count: size.div_ceil(part_size),
            sha256: digest,
        });
    }
    let reopened = open_path(root, path)?;
    if stamp(&file.metadata().map_err(|_| "unreadable")?) != version
        || stamp(&reopened.metadata().map_err(|_| "unreadable")?) != version
        || (mount.is_some() && inventory::mount_identity(&reopened) != mount)
    {
        return Err("changed");
    }
    if cache_miss {
        if let (Some(cache), Some(mount), Some(fingerprint)) =
            (cache, mount.as_deref(), fingerprint.as_ref())
        {
            cache.put(mount, &version, &fingerprint.sha256);
        }
    }
    Ok(Entry {
        path: path.to_owned(),
        id: identity(&before),
        version,
        kind: if before.is_dir() { "folder" } else { "file" },
        size,
        sha256,
        fingerprint,
        symbolic_link: None,
    })
}

/// No search database or pre-existing index is trusted as a backup snapshot.
/// Each run reads the live root using bounded workers and streams to the host.
pub fn capture(
    request: Request,
    emit: impl FnMut(Event) -> Result<(), IndexerError>,
) -> Result<(), IndexerError> {
    capture_inner(request, None, None, None, None, emit)
}
fn capture_inner(
    request: Request,
    control: Option<Arc<WatchControl>>,
    cache: Option<Arc<inventory::Cache>>,
    external_cancelled: Option<Arc<AtomicBool>>,
    receipts: Option<Arc<native_receipts::Receipts>>,
    mut emit: impl FnMut(Event) -> Result<(), IndexerError>,
) -> Result<(), IndexerError> {
    if request.version != 1
        || !request.root.is_absolute()
        || request.excluded_paths.iter().any(|p| !valid_path(p))
        || request
            .ignore_rules
            .as_ref()
            .is_some_and(|s| s.contains('\0'))
    {
        return Err(failure("invalid_request"));
    }
    let root = Arc::new(File::from(
        open(
            &request.root,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| failure("source_unavailable"))?,
    ));
    let initial = root.metadata().map_err(|_| failure("source_unavailable"))?;
    if identity(&initial) != request.root_identity {
        return Err(failure("source_changed"));
    }
    let root_stamp = stamp(&initial);
    let ignores = Arc::new(BackupIgnoreRules::new(
        request.ignore_rules.as_deref().unwrap_or(""),
    ));
    let exclusions: Vec<String> = request.excluded_paths.iter().map(|p| key(p)).collect();
    let invalid = Arc::new(regex::Regex::new(r"[\p{Cc}\p{Cf}]").expect("constant unicode classes"));
    if ![1, 3].contains(&request.cpu_budget_shares) {
        return Err(failure("invalid_configuration"));
    }
    let governor = Arc::new(ResourceGovernor::new_with_cpu_share(
        &request.resource_limits,
        request.cpu_budget_shares,
    )?);
    if request
        .scan_bytes_per_second
        .is_some_and(|rate| !rate.is_finite() || rate <= 0.0)
    {
        return Err(failure("invalid_configuration"));
    }
    governor.set_scan_rate(request.scan_bytes_per_second);
    let source = IndexSource {
        id: "backup".into(),
        root: request.root.clone(),
        kinds: vec![IndexKind::File, IndexKind::Directory],
        respect_git_ignore: false,
        include_hidden: true,
        follow_symlinks: false,
        max_depth: None,
    };
    let mut builder = source_walker(&request.root, &source, &governor);
    // Home grants may contain mounted directories; preserve the existing scope.
    builder.same_file_system(false);
    let walker = builder.build_parallel();
    let (sender, receiver) = mpsc::sync_channel(governor.effective().channel_capacity);
    let sender = EventSender {
        inner: sender,
        sequence: Arc::new(AtomicU64::new(0)),
    };
    let cancelled = external_cancelled.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    // Durable provisional captures must exclude both sides of ambiguous
    // names before publishing. The existing namespace guard also works
    // without a live backup stream.
    let streaming = (request.streaming || cache.is_some())
        .then(streaming::State::new)
        .transpose()?
        .map(|s| Arc::new(Mutex::new(s)));
    let changes = if request.streaming {
        Some(streaming::watch(&request.root)?)
    } else {
        None
    };
    emit(Event::Hello {
        version: 1,
        streaming: request.streaming.then_some(true),
    })?;
    std::thread::scope(|scope| -> Result<(), IndexerError> {
        let cancel_worker = cancelled.clone();
        let governor_worker = governor.clone();
        let root_worker = root.clone();
        let source_path = &request.root;
        let finished = Arc::new(AtomicBool::new(false));
        let policy = Arc::new(streaming::Policy {
            ignores: ignores.clone(),
            exclusions: exclusions.clone(),
            invalid: invalid.clone(),
            receipts: receipts.clone(),
            cache: cache.clone(),
        });
        if let (Some(state), Some(changes)) = (streaming.clone(), changes.as_ref()) {
            let root = root.clone();
            let governor = governor.clone();
            let cancelled = cancelled.clone();
            let finished = finished.clone();
            let sender = sender.clone();
            let control = control.clone();
            let policy = policy.clone();
            scope.spawn(move || {
                streaming::monitor(
                    state, root, governor, cancelled, finished, sender, changes, control, policy,
                )
            });
        }
        let streaming_worker = streaming.clone();
        let worker_policy = policy.clone();
        let changes_worker = changes.as_ref();
        scope.spawn(move || {
            walker.run(|| {
                let sender = sender.clone();
                let cancelled = cancel_worker.clone();
                let governor = governor_worker.clone();
                let root = root_worker.clone();
                let worker_policy = worker_policy.clone();
                let ignores = ignores.clone();
                let exclusions = &exclusions;
                let invalid = invalid.clone();
                let streaming = streaming_worker.clone();
                Box::new(move |candidate| {
                    if cancelled.load(Ordering::Relaxed) {
                        return WalkState::Quit;
                    }
                    let _permit = match governor.admit() {
                        Ok(permit) => permit,
                        Err(_) => {
                            cancelled.store(true, Ordering::Relaxed);
                            return WalkState::Quit;
                        }
                    };
                    if governor.checkpoint().is_err() {
                        cancelled.store(true, Ordering::Relaxed);
                        return WalkState::Quit;
                    }
                    let send = |event| {
                        if sender.send(event).is_err() {
                            cancelled.store(true, Ordering::Relaxed);
                        }
                    };
                    let candidate = match candidate {
                        Ok(value) => value,
                        Err(_) => {
                            send(gap(None, "unreadable", "root"));
                            return WalkState::Continue;
                        }
                    };
                    if candidate.depth() == 0 {
                        return WalkState::Continue;
                    }
                    let relative = match candidate
                        .path()
                        .strip_prefix(source_path)
                        .ok()
                        .and_then(Path::to_str)
                    {
                        Some(p) if valid_path(p) && !invalid.is_match(p) => p,
                        _ => {
                            send(gap(None, "invalid-path", "subtree"));
                            return WalkState::Skip;
                        }
                    };
                    let canonical = key(relative);
                    if exclusions
                        .iter()
                        .any(|x| canonical == *x || canonical.starts_with(&(x.clone() + "/")))
                    {
                        return WalkState::Skip;
                    }
                    let is_dir = candidate.file_type().is_some_and(|t| t.is_dir());
                    if ignores.ignores_entry(relative, is_dir) {
                        send(Event::Ignored);
                        return WalkState::Skip;
                    }
                    if is_dir {
                        if let Some(changes) = changes_worker {
                            if let Err(reason) = changes.track_directory(candidate.path()) {
                                send(gap(Some(relative), reason, "subtree"));
                                return WalkState::Skip;
                            }
                        }
                    }
                    if let Some(state) = &streaming {
                        if let Err(reason) = state
                            .lock()
                            .unwrap()
                            .validate(&root, relative, &governor, &cancelled)
                        {
                            send(gap(Some(relative), reason, "subtree"));
                            return WalkState::Skip;
                        }
                    }
                    match worker_policy.observe(&root, relative, &governor, &cancelled) {
                        Ok(None) => {
                            send(Event::Ignored);
                            return WalkState::Skip;
                        }
                        Ok(Some(entry)) => {
                            if let Some(state) = &streaming {
                                let mut state = state.lock().unwrap();
                                if let Err(reason) =
                                    state.validate(&root, relative, &governor, &cancelled)
                                {
                                    send(gap(Some(relative), reason, "subtree"));
                                    return WalkState::Skip;
                                }
                                if metadata_version(&root, relative).ok().as_ref()
                                    != Some(&entry.version)
                                {
                                    send(gap(Some(relative), "changed", "subtree"));
                                    return WalkState::Skip;
                                }
                                if state.remember(&entry).is_err() {
                                    send(gap(Some(relative), "duplicate-identity", "subtree"));
                                    return WalkState::Skip;
                                }
                                send(Event::Entry { entry });
                            } else {
                                send(Event::Entry { entry });
                            }
                        }
                        Err("cancelled") => {
                            cancelled.store(true, Ordering::Relaxed);
                            return WalkState::Quit;
                        }
                        Err(reason) => {
                            send(gap(
                                Some(relative),
                                reason,
                                if is_dir || matches!(reason, "unreadable" | "changed") {
                                    "subtree"
                                } else {
                                    "entry"
                                },
                            ));
                            return WalkState::Skip;
                        }
                    }
                    WalkState::Continue
                })
            });
            if changes_worker.is_some() {
                let _ = sender.send(Event::Indexed);
            }
            finished.store(true, Ordering::Relaxed);
        });
        // Drain even after a sink failure so blocked workers can exit/join.
        let mut failure = None;
        let mut resource_at = std::time::Instant::now();
        for event in receiver {
            if request.resource_feedback
                && resource_at.elapsed() >= Duration::from_millis(250)
                && failure.is_none()
            {
                if let Err(error) = emit(Event::Resources {
                    usage: governor.snapshot(),
                }) {
                    cancelled.store(true, Ordering::Relaxed);
                    failure = Some(error);
                }
                resource_at = std::time::Instant::now();
            }
            if failure.is_none() {
                if let Err(error) = emit(event) {
                    cancelled.store(true, Ordering::Relaxed);
                    failure = Some(error);
                }
            }
        }
        if let Some(error) = failure {
            return Err(error);
        }
        if cancelled.load(Ordering::Relaxed) {
            return Err(self::failure("capture_cancelled"));
        }
        Ok(())
    })?;
    governor.check_memory_now()?;
    let current = File::from(
        open(
            &request.root,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| failure("source_changed"))?,
    );
    if identity(&current.metadata().map_err(|_| failure("source_changed"))?)
        != request.root_identity
    {
        return Err(failure("source_changed"));
    }
    // A streaming subscription has already accounted for root namespace edits
    // (including gaps for removal/loss). Legacy captures still invalidate the
    // root on any namespace stamp change.
    if !request.streaming
        && stamp(&root.metadata().map_err(|_| failure("source_changed"))?) != root_stamp
    {
        emit(gap(None, "changed", "root"))?;
    }
    if request.resource_feedback {
        emit(Event::Resources {
            usage: governor.finish(),
        })?;
    }
    emit(Event::Complete)
}

pub fn serve(input: impl BufRead + Send + 'static, output: impl Write) -> Result<(), IndexerError> {
    serve_with_database(input, output, None)
}

pub fn serve_with_database(
    mut input: impl BufRead + Send + 'static,
    output: impl Write,
    database: Option<&Path>,
) -> Result<(), IndexerError> {
    let line = inventory::read_request_line(&mut input)?;
    let mut value: serde_json::Value =
        serde_json::from_slice(&line).map_err(|_| failure("invalid_request"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| failure("invalid_request"))?;
    let scope = object
        .remove("scope")
        .map(serde_json::from_value::<inventory::Scope>)
        .transpose()
        .map_err(|_| failure("invalid_request"))?;
    let generation = object
        .remove("generation")
        .map(serde_json::from_value::<String>)
        .transpose()
        .map_err(|_| failure("invalid_request"))?;
    let receipts = object
        .remove("nativeReceiptDirectory")
        .map(serde_json::from_value::<PathBuf>)
        .transpose()
        .map_err(|_| failure("invalid_request"))?;
    if database.is_some() != scope.is_some()
        || (scope.is_none() && (generation.is_some() || receipts.is_some()))
    {
        return Err(failure("invalid_scope"));
    }
    let scoped_limits = if database.is_some() {
        let limits = object
            .remove("resourceLimits")
            .unwrap_or_else(|| serde_json::json!({}));
        Some(inventory::decode_sync_limits(limits).map_err(|_| failure("invalid_request"))?)
    } else {
        None
    };
    let mut request: Request =
        serde_json::from_value(value).map_err(|_| failure("invalid_request"))?;
    if let Some(limits) = scoped_limits {
        request.resource_limits = limits;
    }
    let streaming = request.streaming;
    let mut output = BufWriter::with_capacity(65_536, output);
    let control = streaming.then(|| Arc::new(WatchControl::default()));
    if let Some(control) = control.clone() {
        std::thread::spawn(move || loop {
            let mut line = String::new();
            match input.read_line(&mut line) {
                Ok(0) | Err(_) => {
                    control.disconnected.store(true, Ordering::Relaxed);
                    break;
                }
                Ok(_) => {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                        if value.get("event").and_then(|v| v.as_str()) == Some("stop") {
                            if let Some(sequence) =
                                value.get("afterSequence").and_then(|v| v.as_u64())
                            {
                                *control.requested.lock().unwrap() = Some(sequence);
                            }
                        }
                    }
                }
            }
        });
    }
    if let (Some(database), Some(scope)) = (database, scope) {
        return inventory::scan(
            database,
            request,
            scope,
            generation,
            inventory::ModeKind::Backup,
            control,
            receipts,
            Arc::new(AtomicBool::new(false)),
            |event| {
                serde_json::to_writer(&mut output, &event).map_err(|_| failure("output_closed"))?;
                output
                    .write_all(b"\n")
                    .map_err(|_| failure("output_closed"))?;
                output.flush().map_err(|_| failure("output_closed"))
            },
        );
    }
    capture_inner(request, control, None, None, None, |event| {
        serde_json::to_writer(&mut output, &event).map_err(|_| failure("output_closed"))?;
        output
            .write_all(b"\n")
            .map_err(|_| failure("output_closed"))?;
        // Flush each row: first eligible content must wake the host even while
        // a later directory/hash is blocked. BufWriter still batches each JSON row.
        if matches!(event, Event::Hello { .. } | Event::Complete) || streaming {
            output.flush().map_err(|_| failure("output_closed"))?;
        }
        Ok(())
    })?;
    output.flush().map_err(|_| failure("output_closed"))
}
