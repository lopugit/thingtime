//! Stream canonical ignore traversal without an in-memory sibling frontier.
use super::{source_walker, IndexSource, IndexerError, ResourceGovernor};
use ignore::{DirEntry, WalkState};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub(super) type Visitor =
    Arc<dyn Fn(Result<DirEntry, ignore::Error>, usize) -> WalkState + Send + Sync>;

// ignore's serial iterator uses walkdir's default ten open handles. Staying
// below that threshold prevents walkdir from collecting a closed ancestor's
// remaining siblings into RAM. Boundary directories spill to a private file.
const STREAMING_DEPTH: usize = 8;

pub(super) fn walk(
    root: &Path,
    source: &IndexSource,
    governor: Arc<ResourceGovernor>,
    directory: &Path,
    excluded: Vec<PathBuf>,
    visitor: Visitor,
) -> Result<(), IndexerError> {
    let scratch = tempfile::Builder::new()
        .prefix(".commander-frontier-")
        .tempfile_in(directory)?;
    let frontier = Connection::open(scratch.path())?;
    frontier.execute_batch(
        "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
         PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA temp_store=FILE;
         BEGIN;
         CREATE TABLE frontier(id INTEGER PRIMARY KEY, path TEXT NOT NULL, depth INTEGER NOT NULL);",
    )?;
    frontier.execute(
        "INSERT INTO frontier(path, depth) VALUES (?1, 0)",
        [super::path_text(root)?],
    )?;
    let frontier = Arc::new(Mutex::new(frontier));
    let mut excluded = excluded;
    excluded.push(scratch.path().to_owned());
    let stopped = Arc::new(AtomicBool::new(false));
    let failure = Arc::new(Mutex::new(None));
    loop {
        governor.checkpoint()?;
        if stopped.load(Ordering::Relaxed) {
            break;
        }
        let next: Option<(i64, String, usize)> = frontier
            .lock()
            .unwrap()
            .query_row(
                "SELECT id, path, depth FROM frontier ORDER BY id LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((id, path, base_depth)) = next else {
            break;
        };
        frontier
            .lock()
            .unwrap()
            .execute("DELETE FROM frontier WHERE id=?1", [id])?;
        let remaining = source.max_depth.map(|max| max.saturating_sub(base_depth));
        let depth = governor
            .effective()
            .max_open_directories
            .saturating_sub(1)
            .min(STREAMING_DEPTH)
            .max(1)
            .min(remaining.unwrap_or(usize::MAX));
        let mut builder = source_walker(Path::new(&path), source, &governor);
        builder.max_depth(Some(depth));
        let single_handle = governor.effective().max_open_directories == 1;
        if single_handle {
            builder.threads(1);
        }
        let frontier_filter = Arc::clone(&frontier);
        let visitor_filter = Arc::clone(&visitor);
        let stopped_filter = Arc::clone(&stopped);
        let failure_filter = Arc::clone(&failure);
        let root_filter = root.to_owned();
        let source_filter = source.clone();
        let excluded_filter = excluded.clone();
        // The single-handle path uses the parallel walker's pre-enqueue filter.
        // Returning false means neither files nor directories enter its deque.
        builder.filter_entry(move |entry| {
            if stopped_filter.load(Ordering::Relaxed) {
                return !single_handle;
            }
            if excluded_filter.iter().any(|path| entry.path() == path) {
                return false;
            }
            let actual_depth = base_depth + entry.depth();
            if source_filter.follow_symlinks && entry.file_type().is_some_and(|kind| kind.is_dir())
            {
                match symlink_loop(entry.path()) {
                    Ok(true) => {
                        visitor_filter(
                            Err(ignore::Error::Io(std::io::Error::other(
                                "symbolic link loop",
                            ))),
                            actual_depth,
                        );
                        return false;
                    }
                    Err(error) => {
                        visitor_filter(Err(ignore::Error::Io(error)), actual_depth);
                        return false;
                    }
                    Ok(false) => {}
                }
            }
            let state = visitor_filter(Ok(entry.clone()), actual_depth);
            if matches!(state, WalkState::Quit) {
                stopped_filter.store(true, Ordering::Relaxed);
                return !single_handle;
            }
            if matches!(state, WalkState::Skip) {
                return false;
            }
            let boundary = single_handle || entry.depth() == depth;
            if boundary
                && entry.file_type().is_some_and(|kind| kind.is_dir())
                && source_filter
                    .max_depth
                    .map_or(true, |max| actual_depth < max)
            {
                // A directory may disappear or become inaccessible after its
                // metadata callback. That is a traversal diagnostic, not a
                // failure of the storage transaction or its memory budget.
                match same_device(&root_filter, entry.path()) {
                    Ok(true) => {}
                    Ok(false) => return !single_handle,
                    Err(error) => {
                        visitor_filter(Err(ignore::Error::Io(error)), actual_depth);
                        return false;
                    }
                }
                let queue_path = match super::path_text(entry.path()) {
                    Ok(path) => path,
                    Err(error) => {
                        visitor_filter(
                            Err(ignore::Error::Io(std::io::Error::other(error))),
                            actual_depth,
                        );
                        return false;
                    }
                };
                let enqueue = (|| -> Result<(), IndexerError> {
                    frontier_filter.lock().unwrap().execute(
                        "INSERT INTO frontier(path, depth) VALUES (?1, ?2)",
                        params![queue_path, actual_depth],
                    )?;
                    Ok(())
                })();
                if let Err(error) = enqueue {
                    *failure_filter.lock().unwrap() = Some(error);
                    stopped_filter.store(true, Ordering::Relaxed);
                }
            }
            !single_handle
        });
        if single_handle {
            // Only the current root enters the work deque; all children have
            // already been processed and backpressured in filter_entry.
            builder.build_parallel().run(|| {
                let visitor = Arc::clone(&visitor);
                let stopped = Arc::clone(&stopped);
                Box::new(move |entry| {
                    if stopped.load(Ordering::Relaxed) {
                        return WalkState::Quit;
                    }
                    if base_depth == 0 || entry.is_err() {
                        let state = visitor(entry, base_depth);
                        if matches!(state, WalkState::Quit) {
                            stopped.store(true, Ordering::Relaxed);
                        }
                        state
                    } else {
                        WalkState::Continue
                    }
                })
            });
        } else {
            for entry in builder.build() {
                if stopped.load(Ordering::Relaxed) {
                    break;
                }
                // All non-root entries are processed by filter_entry so it can
                // prune packages and ignored subtrees before the next entry.
                if entry.as_ref().is_ok_and(|entry| entry.depth() > 0) {
                    continue;
                }
                if base_depth > 0 && entry.is_ok() {
                    continue;
                }
                if !matches!(visitor(entry, base_depth), WalkState::Continue) {
                    stopped.store(true, Ordering::Relaxed);
                    break;
                }
            }
        }
    }
    let failure = failure.lock().unwrap().take();
    match failure {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

#[cfg(unix)]
fn same_device(root: &Path, candidate: &Path) -> std::io::Result<bool> {
    use std::os::unix::fs::MetadataExt;
    Ok(fs::metadata(root)?.dev() == fs::metadata(candidate)?.dev())
}

#[cfg(windows)]
fn same_device(root: &Path, candidate: &Path) -> std::io::Result<bool> {
    use winapi_util::{file, Handle};
    Ok(
        file::information(Handle::from_path_any(root)?)?.volume_serial_number()
            == file::information(Handle::from_path_any(candidate)?)?.volume_serial_number(),
    )
}

#[cfg(not(any(unix, windows)))]
fn same_device(_: &Path, _: &Path) -> std::io::Result<bool> {
    Err(std::io::Error::other("filesystem identity is unavailable"))
}

fn symlink_loop(path: &Path) -> std::io::Result<bool> {
    if !fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Ok(false);
    }
    let target = fs::canonicalize(path)?;
    for ancestor in path.ancestors().skip(1) {
        if fs::canonicalize(ancestor)? == target {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{candidate_from_entry, IndexKind, IndexResourceLimits};
    use std::collections::HashSet;
    use std::sync::atomic::AtomicUsize;

    fn source(root: &Path) -> IndexSource {
        IndexSource {
            id: "memory-benchmark".into(),
            root: root.to_owned(),
            kinds: vec![
                IndexKind::File,
                IndexKind::Directory,
                IndexKind::Application,
            ],
            include_hidden: false,
            respect_git_ignore: true,
            follow_symlinks: false,
            max_depth: None,
        }
    }

    fn paths(root: &Path, handles: usize, depth: Option<usize>, bounded: bool) -> HashSet<String> {
        let mut source = source(root);
        source.max_depth = depth;
        source.follow_symlinks = true;
        let governor = Arc::new(
            ResourceGovernor::new(&IndexResourceLimits {
                max_open_directories: handles,
                ..IndexResourceLimits::default()
            })
            .unwrap(),
        );
        let paths = Arc::new(Mutex::new(HashSet::new()));
        let visitor_paths = Arc::clone(&paths);
        let kinds = source.kinds.iter().copied().collect();
        let visitor: Visitor = Arc::new(move |entry, _| {
            let Ok(entry) = entry else {
                return WalkState::Continue;
            };
            let (record, skip) = candidate_from_entry(&entry, &kinds).unwrap();
            if let Some(record) = record {
                visitor_paths.lock().unwrap().insert(record.path);
            }
            if skip {
                WalkState::Skip
            } else {
                WalkState::Continue
            }
        });
        if bounded {
            let state = tempfile::TempDir::new().unwrap();
            walk(root, &source, governor, state.path(), vec![], visitor).unwrap();
            assert_eq!(
                fs::read_dir(state.path()).unwrap().count(),
                0,
                "private frontier removed"
            );
        } else {
            source_walker(root, &source, &governor)
                .build_parallel()
                .run(|| {
                    let visitor = Arc::clone(&visitor);
                    Box::new(move |entry| {
                        let depth = entry.as_ref().map_or(0, |entry| entry.depth());
                        visitor(entry, depth)
                    })
                });
        }
        let collected = paths.lock().unwrap().clone();
        collected
    }

    #[test]
    fn chunks_preserve_canonical_ignore_depth_packages_and_symlinks() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join(".gitignore"), "excluded.txt\n").unwrap();
        fs::write(root.join("excluded.txt"), "excluded").unwrap();
        fs::write(root.join("visible.txt"), "visible").unwrap();
        let mut current = root.clone();
        for _ in 0..12 {
            current.push("nested");
            fs::create_dir(&current).unwrap();
            fs::write(current.join("excluded.txt"), "excluded").unwrap();
            fs::write(current.join("visible.txt"), "visible").unwrap();
        }
        fs::create_dir_all(current.join("Example.app/Contents")).unwrap();
        fs::write(current.join("Example.app/Contents/hidden.txt"), "hidden").unwrap();
        fs::write(current.join(".ignore"), "visible.txt\n").unwrap();
        fs::write(current.join(".gitignore"), "!visible.txt\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&root, current.join("loop")).unwrap();
        for depth in [None, Some(0), Some(3), Some(9)] {
            let expected = paths(&root, 16, depth, false);
            for handles in [1, 2, 16] {
                assert_eq!(
                    paths(&root, handles, depth, true),
                    expected,
                    "handles={handles},depth={depth:?}"
                );
            }
        }
    }

    #[test]
    fn wide_files_and_directories_complete_under_512_mib_without_hidden_frontier() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        for index in 0..4_096 {
            fs::write(root.join(format!("file-{index}")), "").unwrap();
            fs::create_dir(root.join(format!("dir-{index}"))).unwrap();
        }
        let all = paths(&root, 16, None, true);
        assert_eq!(all.len(), 8_193);
        assert!(all
            .iter()
            .all(|path| !path.contains(".commander-frontier-")));
    }

    #[test]
    fn vanished_boundary_directories_are_diagnostics_and_do_not_abort_siblings() {
        for handles in [1_usize, 2, 16] {
            let temp = tempfile::TempDir::new().unwrap();
            let root = fs::canonicalize(temp.path()).unwrap();
            let mut boundary = root.clone();
            for _ in 0..handles.saturating_sub(2).min(7) {
                boundary.push("nested");
                fs::create_dir(&boundary).unwrap();
            }
            fs::create_dir(boundary.join("raced")).unwrap();
            fs::write(root.join("kept"), "").unwrap();
            let diagnostics = Arc::new(AtomicUsize::new(0));
            let diagnostic_visitor = Arc::clone(&diagnostics);
            let kept = Arc::new(AtomicBool::new(false));
            let kept_visitor = Arc::clone(&kept);
            let visitor: Visitor = Arc::new(move |entry, _| {
                match entry {
                    Err(_) => {
                        diagnostic_visitor.fetch_add(1, Ordering::Relaxed);
                    }
                    Ok(entry) => {
                        if entry.file_name() == "raced" {
                            fs::remove_dir(entry.path()).unwrap();
                        }
                        if entry.file_name() == "kept" {
                            kept_visitor.store(true, Ordering::Relaxed);
                        }
                    }
                }
                WalkState::Continue
            });
            let state = tempfile::TempDir::new().unwrap();
            let governor = Arc::new(
                ResourceGovernor::new(&IndexResourceLimits {
                    max_open_directories: handles,
                    ..IndexResourceLimits::default()
                })
                .unwrap(),
            );
            walk(
                &root,
                &source(&root),
                governor,
                state.path(),
                vec![],
                visitor,
            )
            .unwrap();
            assert!(diagnostics.load(Ordering::Relaxed) > 0);
            assert!(kept.load(Ordering::Relaxed));
        }
    }

    // APFS rejects this filename at creation (EILSEQ); Unix filesystems that
    // accept arbitrary bytes exercise the unrepresentable-path warning here.
    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn unrepresentable_boundary_directory_does_not_abort_the_source() {
        use std::os::unix::ffi::OsStrExt;
        let temp = tempfile::TempDir::new().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir(root.join(std::ffi::OsStr::from_bytes(b"bad-\xff"))).unwrap();
        fs::write(root.join("kept"), "").unwrap();
        let governor = Arc::new(
            ResourceGovernor::new(&IndexResourceLimits {
                max_open_directories: 1,
                ..IndexResourceLimits::default()
            })
            .unwrap(),
        );
        let diagnostics = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&diagnostics);
        let visitor: Visitor = Arc::new(move |entry, _| {
            if entry.is_err() {
                observed.fetch_add(1, Ordering::Relaxed);
            }
            WalkState::Continue
        });
        let state = tempfile::TempDir::new().unwrap();
        walk(
            &root,
            &source(&root),
            governor,
            state.path(),
            vec![],
            visitor,
        )
        .unwrap();
        assert!(diagnostics.load(Ordering::Relaxed) > 0);
    }

    /// Metadata-only traversal; never opens the installed database or files'
    /// indexed contents (canonical ignore files are still read). Run explicitly with COMMANDER_INDEX_BENCH_ROOT=/ for real scale.
    #[test]
    #[ignore]
    fn real_root_metadata_stays_within_512_mib() {
        let root =
            fs::canonicalize(std::env::var("COMMANDER_INDEX_BENCH_ROOT").expect("explicit root"))
                .unwrap();
        let source = source(&root);
        let state = tempfile::TempDir::new().unwrap();
        let governor = Arc::new(ResourceGovernor::new(&IndexResourceLimits::default()).unwrap());
        let count = Arc::new(AtomicUsize::new(0));
        let count_visitor = Arc::clone(&count);
        let governor_visitor = Arc::clone(&governor);
        let kinds = source.kinds.iter().copied().collect();
        let visitor: Visitor = Arc::new(move |entry, _| {
            governor_visitor.checkpoint().expect("512 MiB budget");
            let Ok(entry) = entry else {
                return WalkState::Continue;
            };
            #[cfg(target_os = "macos")]
            if entry.path() == Path::new("/System/Volumes/Data") {
                return WalkState::Skip;
            }
            let (candidate, skip) = candidate_from_entry(&entry, &kinds).unwrap();
            if candidate.is_some() {
                count_visitor.fetch_add(1, Ordering::Relaxed);
            }
            if skip {
                WalkState::Skip
            } else {
                WalkState::Continue
            }
        });
        walk(
            &root,
            &source,
            Arc::clone(&governor),
            state.path(),
            vec![],
            visitor,
        )
        .unwrap();
        governor.check_memory_now().unwrap();
        let usage = governor.finish();
        eprintln!(
            "metadata-only records={} peakMiB={} wallMs={}",
            count.load(Ordering::Relaxed),
            usage.peak_memory_bytes.div_ceil(1024 * 1024),
            usage.wall_time_nanoseconds / 1_000_000
        );
    }
}
