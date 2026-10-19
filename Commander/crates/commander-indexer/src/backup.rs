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
use rustix::fs::{open, openat, statat, AtFlags, FileType, Mode, OFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{File, Metadata};
use std::io::{BufRead, BufWriter, Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use unicode_normalization::UnicodeNormalization;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub root: PathBuf,
    pub root_identity: String,
    #[serde(default)]
    pub excluded_paths: Vec<String>,
    #[serde(default)]
    pub ignore_rules: Option<String>,
    #[serde(default)]
    pub resource_limits: IndexResourceLimits,
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
    Hello { version: u32 },
    Entry { entry: Entry },
    Skipped { gap: Gap },
    Ignored,
    Complete,
}

fn failure(code: &'static str) -> IndexerError {
    IndexerError::new(code, "Backup indexing could not complete.")
}
fn identity(m: &Metadata) -> String {
    format!("{}:{}", m.dev(), m.ino())
}
fn stamp(m: &Metadata) -> String {
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
fn open_path(root: &File, path: &str) -> Result<File, &'static str> {
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
        {
            return Err("changed");
        }
        parent = file;
    }
    Ok(parent)
}

fn observe(
    root: &File,
    path: &str,
    governor: &ResourceGovernor,
    cancelled: &AtomicBool,
) -> Result<Entry, &'static str> {
    let mut file = open_path(root, path)?;
    let before = file.metadata().map_err(|_| "unreadable")?;
    let version = stamp(&before);
    let size = if before.is_dir() { 0 } else { before.size() };
    if size > 9_007_199_254_740_991 {
        return Err("special");
    }
    let mut fingerprint = None;
    let sha256 = if before.is_file() && size == 0 {
        Some(format!("{:x}", Sha256::digest([])))
    } else {
        None
    };
    if before.is_file() && size > 0 {
        let mib = 1_048_576;
        let part_size = (8 * mib).max(size.div_ceil(10_000)).div_ceil(mib) * mib;
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
            let n = file.read(&mut buffer[..wanted]).map_err(|_| "unreadable")?;
            if n == 0 {
                return Err("changed");
            }
            part.update(&buffer[..n]);
            offset += n as u64;
            in_part += n as u64;
            if in_part == part_size || offset == size {
                composite.update(part.finalize_reset());
                in_part = 0;
            }
        }
        fingerprint = Some(Fingerprint {
            algorithm: "sha256-parts-v1",
            part_size_bytes: part_size,
            part_count: size.div_ceil(part_size),
            sha256: format!("{:x}", composite.finalize()),
        });
    }
    if stamp(&file.metadata().map_err(|_| "unreadable")?) != version
        || stamp(
            &open_path(root, path)?
                .metadata()
                .map_err(|_| "unreadable")?,
        ) != version
    {
        return Err("changed");
    }
    Ok(Entry {
        path: path.to_owned(),
        id: identity(&before),
        version,
        kind: if before.is_dir() { "folder" } else { "file" },
        size,
        sha256,
        fingerprint,
    })
}

/// No search database or pre-existing index is trusted as a backup snapshot.
/// Each run reads the live root using bounded workers and streams to the host.
pub fn capture(
    request: Request,
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
    let governor = Arc::new(ResourceGovernor::new(&request.resource_limits)?);
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
    let cancelled = Arc::new(AtomicBool::new(false));
    emit(Event::Hello { version: 1 })?;
    std::thread::scope(|scope| -> Result<(), IndexerError> {
        let cancel_worker = cancelled.clone();
        let governor_worker = governor.clone();
        let root_worker = root.clone();
        let source_path = &request.root;
        scope.spawn(move || {
            walker.run(|| {
                let sender = sender.clone();
                let cancelled = cancel_worker.clone();
                let governor = governor_worker.clone();
                let root = root_worker.clone();
                let ignores = ignores.clone();
                let exclusions = &exclusions;
                let invalid = invalid.clone();
                Box::new(move |candidate| {
                    if cancelled.load(Ordering::Relaxed) {
                        return WalkState::Quit;
                    }
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
                    match observe(&root, relative, &governor, &cancelled) {
                        Ok(entry) => send(Event::Entry { entry }),
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
        });
        // Drain even after a sink failure so blocked workers can exit/join.
        let mut failure = None;
        for event in receiver {
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
    if stamp(&root.metadata().map_err(|_| failure("source_changed"))?) != root_stamp {
        emit(gap(None, "changed", "root"))?;
    }
    emit(Event::Complete)
}

pub fn serve(mut input: impl BufRead, output: impl Write) -> Result<(), IndexerError> {
    let mut line = String::new();
    input
        .read_line(&mut line)
        .map_err(|_| failure("invalid_request"))?;
    let request = serde_json::from_str(&line).map_err(|_| failure("invalid_request"))?;
    let mut output = BufWriter::with_capacity(65_536, output);
    capture(request, |event| {
        serde_json::to_writer(&mut output, &event).map_err(|_| failure("output_closed"))?;
        output
            .write_all(b"\n")
            .map_err(|_| failure("output_closed"))?;
        if matches!(event, Event::Hello { .. } | Event::Complete) {
            output.flush().map_err(|_| failure("output_closed"))?;
        }
        Ok(())
    })?;
    output.flush().map_err(|_| failure("output_closed"))
}
