//! Bounded disk-backed namespace validation and live revision observation.
use super::*;
use rusqlite::{params, Connection};

pub(super) struct State {
    db: Connection,
}
impl State {
    pub(super) fn new() -> Result<Self, IndexerError> {
        // Empty filename is a private temporary database. The bundled Unix
        // SQLite VFS unlinks DELETEONCLOSE files immediately after opening;
        // spilled pages therefore have no path that our walker can capture.
        let db = Connection::open("").map_err(|_| failure("streaming_unavailable"))?;
        db.execute_batch("PRAGMA cache_size=-2048; PRAGMA temp_store=FILE;
            CREATE TABLE dirs(path TEXT PRIMARY KEY, stamp TEXT NOT NULL);
            CREATE TABLE names(parent TEXT, canonical TEXT, name TEXT);
            CREATE INDEX lookup ON names(parent,canonical);
            CREATE TABLE observed(seq INTEGER PRIMARY KEY, path TEXT UNIQUE, version TEXT NOT NULL, parent TEXT NOT NULL, identity TEXT NOT NULL, link INTEGER NOT NULL);
            CREATE INDEX observed_parent ON observed(parent);
            CREATE UNIQUE INDEX observed_identity ON observed(identity);").map_err(|_| failure("streaming_unavailable"))?;
        Ok(Self { db })
    }
    pub(super) fn validate(
        &mut self,
        root: &File,
        path: &str,
        governor: &ResourceGovernor,
        cancelled: &AtomicBool,
    ) -> Result<(), &'static str> {
        let mut parent_path = String::new();
        for component in path.split('/') {
            let parent = if parent_path.is_empty() {
                root.try_clone().map_err(|_| "unreadable")?
            } else {
                open_path(root, &parent_path)?
            };
            let before = stamp(&parent.metadata().map_err(|_| "unreadable")?);
            let cached = self
                .db
                .query_row(
                    "SELECT stamp FROM dirs WHERE path=?1",
                    [&parent_path],
                    |r| r.get::<_, String>(0),
                )
                .ok();
            if cached.as_deref() != Some(&before) {
                let tx = self.db.transaction().map_err(|_| "unreadable")?;
                tx.execute("DELETE FROM names WHERE parent=?1", [&parent_path])
                    .map_err(|_| "unreadable")?;
                let mut dir = rustix::fs::Dir::read_from(&parent).map_err(io_reason)?;
                for item in &mut dir {
                    if cancelled.load(Ordering::Relaxed) || governor.checkpoint().is_err() {
                        return Err("cancelled");
                    }
                    let item = item.map_err(io_reason)?;
                    let bytes = item.file_name().to_bytes();
                    if bytes == b"." || bytes == b".." {
                        continue;
                    }
                    let name = std::str::from_utf8(bytes).map_err(|_| "invalid-path")?;
                    tx.execute(
                        "INSERT INTO names VALUES(?1,?2,?3)",
                        params![parent_path, key(name), name],
                    )
                    .map_err(|_| "unreadable")?;
                }
                if stamp(&parent.metadata().map_err(|_| "unreadable")?) != before {
                    return Err("changed");
                }
                tx.execute(
                    "INSERT OR REPLACE INTO dirs VALUES(?1,?2)",
                    params![parent_path, before],
                )
                .map_err(|_| "unreadable")?;
                tx.commit().map_err(|_| "unreadable")?;
            }
            let count: u64 = self
                .db
                .query_row(
                    "SELECT count(*) FROM names WHERE parent=?1 AND canonical=?2",
                    params![parent_path, key(component)],
                    |r| r.get(0),
                )
                .map_err(|_| "unreadable")?;
            if count != 1 {
                return Err(if count > 1 { "collision" } else { "changed" });
            }
            if stamp(&parent.metadata().map_err(|_| "unreadable")?) != before {
                return Err("changed");
            }
            if !parent_path.is_empty() {
                parent_path.push('/');
            }
            parent_path.push_str(component);
        }
        Ok(())
    }
    pub(super) fn remember(&mut self, entry: &Entry) -> Result<(), rusqlite::Error> {
        self.db.execute("INSERT INTO observed(path,version,parent,identity,link) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(path) DO UPDATE SET version=excluded.version,identity=excluded.identity,link=excluded.link", params![entry.path, entry.version, entry.path.rsplit_once('/').map(|(p,_)| p).unwrap_or(""), entry.id,entry.symbolic_link.is_some()])?;
        Ok(())
    }
}

// Subscribe before traversal so modifications to rows already emitted are not
// lost while another worker is hashing or enumerating a different subtree.
pub(super) struct Changes {
    watcher: Mutex<notify::RecommendedWatcher>,
    receiver: Mutex<mpsc::Receiver<Result<notify::Event, notify::Error>>>,
    overflow: Arc<AtomicBool>,
    root: PathBuf,
}
fn strict_backend(kind: notify::WatcherKind) -> bool {
    matches!(
        kind,
        notify::WatcherKind::Fsevent | notify::WatcherKind::Inotify
    )
}

pub(super) fn supports_strict() -> bool {
    use notify::Watcher;
    cfg!(any(target_os = "macos", target_os = "linux"))
        && strict_backend(notify::RecommendedWatcher::kind())
}

pub(super) fn watch_strict(root: &Path) -> Result<Changes, IndexerError> {
    // Polling can miss writes between validation and publication. Do not
    // present it as complete coverage (iOS currently selects PollWatcher).
    if !supports_strict() {
        return Err(failure("strict_watcher_unavailable"));
    }
    watch_mode(root, true)
}

pub(super) fn watch(root: &Path) -> Result<Changes, IndexerError> {
    watch_mode(root, false)
}

fn watch_mode(root: &Path, sealing: bool) -> Result<Changes, IndexerError> {
    use notify::Watcher;
    // Keep one bounded burst of precise native events while a seal checks its
    // first batch of descriptors. Overflow still invalidates coverage.
    let (sender, receiver) = mpsc::sync_channel(if sealing { 4096 } else { 1024 });
    let overflow = Arc::new(AtomicBool::new(false));
    let lost = overflow.clone();
    let mut watcher =
        notify::recommended_watcher(move |event: Result<notify::Event, notify::Error>| {
            if event.as_ref().is_ok_and(|event| {
                !event.need_rescan() && matches!(event.kind, notify::EventKind::Access(_))
            }) {
                return;
            }
            if sender.try_send(event).is_err() {
                lost.store(true, Ordering::Relaxed);
            }
        })
        .map_err(|_| failure("streaming_unavailable"))?;
    watcher
        .watch(
            root,
            if cfg!(target_os = "macos") {
                notify::RecursiveMode::Recursive
            } else {
                notify::RecursiveMode::NonRecursive
            },
        )
        .map_err(|_| failure("streaming_unavailable"))?;
    Ok(Changes {
        watcher: Mutex::new(watcher),
        receiver: Mutex::new(receiver),
        overflow,
        root: root
            .canonicalize()
            .map_err(|_| failure("streaming_unavailable"))?,
    })
}
impl Changes {
    // Lost events and unknown paths still invalidate membership. An ordinary
    // precise path hint can instead be checked against its exact saved stamp.
    pub(super) fn check_quiet(
        &self,
        root: &File,
        policy: &Policy,
        mut unchanged: impl FnMut(&str) -> bool,
    ) -> Result<(), Option<String>> {
        let receiver = self.receiver.lock().unwrap();
        loop {
            if self.overflow.load(Ordering::Relaxed) {
                return Err(None);
            }
            match receiver.try_recv() {
                Err(mpsc::TryRecvError::Empty) if !self.overflow.load(Ordering::Relaxed) => {
                    return Ok(())
                }
                Ok(Ok(event))
                    if !event.need_rescan()
                        && matches!(event.kind, notify::EventKind::Access(_)) =>
                {
                    ()
                }
                Ok(Ok(event)) if !event.need_rescan() && !event.paths.is_empty() => {
                    // These notify attributes denote device/root changes,
                    // rather than ordinary precise item events.
                    if matches!(event.info(), Some("root changed" | "mount")) {
                        return Err(None);
                    }
                    for path in event.paths {
                        let relative = path
                            .strip_prefix(&self.root)
                            .ok()
                            .and_then(Path::to_str)
                            .filter(|p| p.is_empty() || valid_path(p));
                        if relative.is_some_and(|p| {
                            (!p.is_empty() && policy.pruned_event_kind(root, p, None))
                                || unchanged(p)
                        }) {
                            continue;
                        }
                        return Err(relative.filter(|p| !p.is_empty()).map(str::to_owned));
                    }
                }
                _ => return Err(None),
            }
        }
    }
    pub(super) fn track_directory(&self, path: &Path) -> Result<(), &'static str> {
        // Linux inotify recursive setup walks the entire root synchronously.
        // Install each watch as our existing walker reaches that directory.
        if !cfg!(target_os = "macos") {
            use notify::Watcher;
            self.watcher
                .lock()
                .unwrap()
                .watch(path, notify::RecursiveMode::NonRecursive)
                .map_err(|_| "unreadable")?;
        }
        Ok(())
    }
}
pub(super) struct Policy {
    pub(super) ignores: Arc<BackupIgnoreRules>,
    pub(super) exclusions: Vec<String>,
    pub(super) invalid: Arc<regex::Regex>,
    pub(super) receipts: Option<Arc<native_receipts::Receipts>>,
    pub(super) cache: Option<Arc<inventory::Cache>>,
}
impl Policy {
    // Prune private-cache/excluded notifications before any indexed-row query.
    // Otherwise a WAL write under an excluded subtree can still repeatedly
    // query a multi-million-row capture even though it cannot emit an entry.
    #[cfg(test)]
    fn pruned_event(&self, root: &File, path: &str) -> bool {
        self.pruned_event_kind(root, path, None)
    }
    fn pruned_event_kind(&self, root: &File, path: &str, directory: Option<bool>) -> bool {
        let canonical = key(path);
        if self
            .exclusions
            .iter()
            .any(|x| canonical == *x || canonical.starts_with(&(x.clone() + "/")))
        {
            return true;
        }
        for (offset, _) in path.match_indices('/') {
            if self.ignores.ignores_entry(&path[..offset], true) {
                return true;
            }
        }
        let kind = directory.or_else(|| {
            open_path(root, path)
                .ok()
                .and_then(|file| file.metadata().ok())
                .map(|m| m.is_dir())
        });
        // Missing paths still need coverage-gap handling. Do not guess that a
        // removed file matched a directory-only ignore rule.
        kind.is_some_and(|is_dir| self.ignores.ignores_entry(path, is_dir))
    }
    pub(super) fn observe(
        &self,
        root: &File,
        path: &str,
        governor: &ResourceGovernor,
        cancelled: &AtomicBool,
    ) -> Result<Option<Entry>, &'static str> {
        observe_projected(
            root,
            path,
            governor,
            cancelled,
            self.cache.as_deref(),
            None,
            self.receipts.as_deref(),
        )
    }
    fn eligible(
        &self,
        root: &File,
        path: &str,
        governor: &ResourceGovernor,
        cancelled: &AtomicBool,
    ) -> Result<bool, &'static str> {
        if !valid_path(path) || self.invalid.is_match(path) {
            return Err("invalid-path");
        }
        let canonical = key(path);
        if self
            .exclusions
            .iter()
            .any(|x| canonical == *x || canonical.starts_with(&(x.clone() + "/")))
        {
            return Ok(false);
        }
        let mut prefix = String::new();
        for part in path.split('/') {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            let is_dir = match open_path(root, &prefix) {
                Ok(file) => file.metadata().map_err(|_| "unreadable")?.is_dir(),
                Err("symlink") if prefix == path => false,
                Err(reason) => return Err(reason),
            };
            if is_dir {
                if let Some(receipts) = &self.receipts {
                    if matches!(
                        receipts.inspect(root, &prefix, governor, cancelled)?,
                        native_receipts::Projection::Skip
                    ) {
                        return Ok(false);
                    }
                }
            }
            if self.ignores.ignores_entry(&prefix, is_dir) {
                return Ok(false);
            }
        }
        Ok(true)
    }
}
pub(super) fn monitor(
    state: Arc<Mutex<State>>,
    root: Arc<File>,
    governor: Arc<ResourceGovernor>,
    cancelled: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    sender: EventSender,
    changes: &Changes,
    control: Option<Arc<WatchControl>>,
    policy: Arc<Policy>,
) {
    let mut finished_at = None;
    let mut stopping = None;
    while !cancelled.load(Ordering::Relaxed) {
        if finished.load(Ordering::Relaxed) {
            let since = finished_at.get_or_insert_with(std::time::Instant::now);
            if let Some(control) = &control {
                if control.disconnected.load(Ordering::Relaxed)
                    && since.elapsed() >= Duration::from_millis(200)
                {
                    break;
                }
                let requested = *control.requested.lock().unwrap();
                if let Some(expected) = requested {
                    let start = stopping.get_or_insert_with(std::time::Instant::now);
                    if start.elapsed() >= Duration::from_millis(200) {
                        if sender.sequence.load(Ordering::SeqCst) == expected {
                            break;
                        }
                        *control.requested.lock().unwrap() = None;
                        stopping = None;
                        if sender.send(Event::Indexed).is_err() {
                            cancelled.store(true, Ordering::Relaxed);
                            break;
                        }
                    }
                } else {
                    stopping = None;
                }
            } else if since.elapsed() >= Duration::from_millis(200) {
                break;
            }
        }
        if changes.overflow.swap(false, Ordering::Relaxed) {
            // Lost notifications invalidate capture completeness; never silently
            // trust a partial observation or fall back to a second full scan.
            if sender.send(gap(None, "changed", "root")).is_err() {
                cancelled.store(true, Ordering::Relaxed);
                break;
            }
        }
        let event = changes
            .receiver
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_millis(50));
        let event = match event {
            Ok(Ok(event)) => event,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            _ => {
                let _ = sender.send(gap(None, "changed", "root"));
                break;
            }
        };
        if matches!(event.kind, notify::EventKind::Access(_)) {
            continue;
        }
        if event.need_rescan() {
            let _ = sender.send(gap(None, "changed", "root"));
        }
        let namespace = !matches!(
            event.kind,
            notify::EventKind::Modify(notify::event::ModifyKind::Data(_))
        );
        let directory = match event.kind {
            notify::EventKind::Create(notify::event::CreateKind::Folder)
            | notify::EventKind::Remove(notify::event::RemoveKind::Folder) => Some(true),
            notify::EventKind::Create(notify::event::CreateKind::File)
            | notify::EventKind::Remove(notify::event::RemoveKind::File) => Some(false),
            _ => None,
        };
        for changed in event.paths {
            let relative = match changed
                .strip_prefix(&changes.root)
                .ok()
                .and_then(Path::to_str)
            {
                Some(s) => s,
                None => continue,
            };
            let pruned =
                !relative.is_empty() && policy.pruned_event_kind(&root, relative, directory);
            if pruned && !namespace {
                continue;
            }
            if !relative.is_empty() && !pruned {
                discover(
                    &state, &root, relative, &governor, &cancelled, &sender, changes, &policy,
                );
            }
            // Namespace changes also change the immediate directory's full stamp.
            // A pruned child may refresh only that indexed parent: never discover
            // the excluded subtree or revalidate its unrelated siblings.
            let parent = relative.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
            let prefix = format!("{relative}/");
            let upper = format!("{prefix}\u{10ffff}");
            let mut cursor = 0_i64;
            loop {
                let rows: Vec<(i64, String, String, bool)> = {
                    let state = state.lock().unwrap();
                    let result = (|| -> Result<_, rusqlite::Error> {
                        let sql = if pruned {
                            "SELECT seq,path,version,link FROM observed WHERE seq>?1 AND path=?4 AND ?2 IS NOT NULL AND ?3=1 AND ?5 IS NOT NULL AND ?6 IS NOT NULL ORDER BY seq LIMIT 64"
                        } else if namespace {
                            "SELECT seq,path,version,link FROM observed WHERE seq>?1 AND (path=?2 OR path=?4 OR parent=?4 OR (path>=?5 AND path<?6)) ORDER BY seq LIMIT 64"
                        } else {
                            "SELECT seq,path,version,link FROM observed WHERE seq>?1 AND path=?2 AND ?3=0 AND ?4 IS NOT NULL AND ?5 IS NOT NULL AND ?6 IS NOT NULL"
                        };
                        let mut query = state.db.prepare(sql)?;
                        let rows = query
                            .query_map(
                                params![cursor, relative, namespace, parent, prefix, upper],
                                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                            )?
                            .collect::<Result<Vec<_>, _>>()?;
                        Ok(rows)
                    })();
                    match result {
                        Ok(rows) => rows,
                        Err(_) => {
                            cancelled.store(true, Ordering::Relaxed);
                            return;
                        }
                    }
                };
                if rows.is_empty() {
                    break;
                }
                for (seq, path, version, was_link) in rows {
                    cursor = seq;
                    if cancelled.load(Ordering::Relaxed) {
                        return;
                    }
                    let valid = {
                        state
                            .lock()
                            .unwrap()
                            .validate(&root, &path, &governor, &cancelled)
                    };
                    let result = valid.and_then(|_| {
                        let file = open_metadata_entry(&root, &path)?;
                        let metadata = file.metadata().map_err(|_| "unreadable")?;
                        if metadata.is_symlink() && !was_link {
                            return Err("symlink");
                        }
                        if stamp(&metadata) == version {
                            return if inventory::has_precise_stamps(&file) {
                                Ok(None)
                            } else {
                                Err("changed")
                            };
                        }
                        policy.observe(&root, &path, &governor, &cancelled)
                    });
                    let event = match result {
                        Ok(None) => continue,
                        Ok(Some(entry)) => {
                            let mut state = state.lock().unwrap();
                            if let Err(reason) = state.validate(&root, &path, &governor, &cancelled)
                            {
                                gap(Some(&path), reason, "subtree")
                            } else if metadata_version(&root, &path).ok().as_ref()
                                != Some(&entry.version)
                            {
                                gap(Some(&path), "changed", "subtree")
                            } else {
                                if state.remember(&entry).is_err() {
                                    cancelled.store(true, Ordering::Relaxed);
                                    return;
                                }
                                Event::Entry { entry }
                            }
                        }
                        Err("cancelled") => {
                            cancelled.store(true, Ordering::Relaxed);
                            return;
                        }
                        Err(reason) => gap(Some(&path), reason, "subtree"),
                    };
                    if sender.send(event).is_err() {
                        cancelled.store(true, Ordering::Relaxed);
                        return;
                    }
                }
            }
        }
    }
}

fn discover(
    state: &Arc<Mutex<State>>,
    root: &File,
    path: &str,
    governor: &ResourceGovernor,
    cancelled: &AtomicBool,
    sender: &EventSender,
    changes: &Changes,
    policy: &Policy,
) {
    // SQLite is also the pending-directory queue, keeping arbitrarily broad
    // newly-created subtrees off the process heap.
    let queued = {
        let state = state.lock().unwrap();
        state
            .db
            .execute(
                "CREATE TABLE IF NOT EXISTS pending(path TEXT PRIMARY KEY)",
                [],
            )
            .and_then(|_| {
                state
                    .db
                    .execute("INSERT OR IGNORE INTO pending VALUES(?1)", [path])
            })
    };
    if queued.is_err() {
        cancelled.store(true, Ordering::Relaxed);
        return;
    }
    loop {
        let next = {
            let state = state.lock().unwrap();
            state
                .db
                .query_row("SELECT path FROM pending LIMIT 1", [], |r| {
                    r.get::<_, String>(0)
                })
                .ok()
        };
        let Some(path) = next else {
            break;
        };
        {
            let state = state.lock().unwrap();
            if state
                .db
                .execute("DELETE FROM pending WHERE path=?1", [&path])
                .is_err()
            {
                cancelled.store(true, Ordering::Relaxed);
                return;
            }
        }
        if cancelled.load(Ordering::Relaxed) || governor.checkpoint().is_err() {
            cancelled.store(true, Ordering::Relaxed);
            return;
        }
        match policy.eligible(root, &path, governor, cancelled) {
            Ok(false) => continue,
            Err(reason) => {
                let _ = sender.send(gap(Some(&path), reason, "subtree"));
                continue;
            }
            Ok(true) => (),
        }
        let existing = {
            let state = state.lock().unwrap();
            state
                .db
                .query_row("SELECT version FROM observed WHERE path=?1", [&path], |r| {
                    r.get::<_, String>(0)
                })
                .ok()
        };
        // Existing rows are handled by indexed revalidation below. Only unseen
        // directories need discovery; no established subtree is walked again.
        if existing.is_some() {
            continue;
        }
        let validation = {
            state
                .lock()
                .unwrap()
                .validate(root, &path, governor, cancelled)
        };
        if let Err(reason) = validation {
            let _ = sender.send(gap(Some(&path), reason, "subtree"));
            continue;
        }
        match policy.observe(root, &path, governor, cancelled) {
            Ok(None) => continue,
            Ok(Some(entry)) => {
                let directory = entry.kind == "folder";
                let mut state = state.lock().unwrap();
                if let Err(reason) = state.validate(root, &path, governor, cancelled) {
                    let _ = sender.send(gap(Some(&path), reason, "subtree"));
                    continue;
                }
                if state.remember(&entry).is_err() {
                    let _ = sender.send(gap(Some(&path), "duplicate-identity", "subtree"));
                    continue;
                }
                if sender.send(Event::Entry { entry }).is_err() {
                    cancelled.store(true, Ordering::Relaxed);
                    return;
                }
                if directory {
                    if changes.track_directory(&changes.root.join(&path)).is_err() {
                        let _ = sender.send(gap(Some(&path), "unreadable", "subtree"));
                        continue;
                    }
                    let file = match open_path(root, &path) {
                        Ok(file) => file,
                        Err(reason) => {
                            let _ = sender.send(gap(Some(&path), reason, "subtree"));
                            continue;
                        }
                    };
                    let dir = match rustix::fs::Dir::read_from(&file) {
                        Ok(dir) => dir,
                        Err(_) => {
                            let _ = sender.send(gap(Some(&path), "unreadable", "subtree"));
                            continue;
                        }
                    };
                    for child in dir {
                        if cancelled.load(Ordering::Relaxed) || governor.checkpoint().is_err() {
                            cancelled.store(true, Ordering::Relaxed);
                            return;
                        }
                        let child = match child {
                            Ok(child) => child,
                            Err(_) => {
                                let _ = sender.send(gap(Some(&path), "unreadable", "subtree"));
                                break;
                            }
                        };
                        let name = match child.file_name().to_str() {
                            Ok(name) if name != "." && name != ".." => name,
                            _ => continue,
                        };
                        if state
                            .db
                            .execute(
                                "INSERT OR IGNORE INTO pending VALUES(?1)",
                                [format!("{path}/{name}")],
                            )
                            .is_err()
                        {
                            cancelled.store(true, Ordering::Relaxed);
                            return;
                        }
                    }
                }
            }
            Err(reason) => {
                let _ = sender.send(gap(Some(&path), reason, "subtree"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn test_policy() -> Arc<Policy> {
        Arc::new(Policy {
            ignores: Arc::new(BackupIgnoreRules::new("")),
            exclusions: vec![],
            invalid: Arc::new(regex::Regex::new(r"[\p{Cc}\p{Cf}]").unwrap()),
            receipts: None,
            cache: None,
        })
    }
    fn fixture() -> (TempDir, Arc<File>, Arc<ResourceGovernor>, Arc<AtomicBool>) {
        let dir = TempDir::new().unwrap();
        let root = Arc::new(File::open(dir.path()).unwrap());
        let limits = IndexResourceLimits {
            max_cpu_percent: 100,
            ..Default::default()
        };
        (
            dir,
            root,
            Arc::new(ResourceGovernor::new(&limits).unwrap()),
            Arc::new(AtomicBool::new(false)),
        )
    }
    // Inject exactly one notification; no operating-system event timing is
    // involved. The existing finite monitor drain bounds each invocation.
    fn injected(
        dir: &TempDir,
        root: Arc<File>,
        governor: Arc<ResourceGovernor>,
        cancelled: Arc<AtomicBool>,
        state: Arc<Mutex<State>>,
        policy: Arc<Policy>,
        kind: notify::EventKind,
        paths: &[&str],
    ) -> Vec<Event> {
        let (input, receiver) = mpsc::sync_channel(1);
        let changes = Changes {
            watcher: Mutex::new(notify::recommended_watcher(|_| {}).unwrap()),
            receiver: Mutex::new(receiver),
            overflow: Arc::new(AtomicBool::new(false)),
            root: dir.path().canonicalize().unwrap(),
        };
        let mut event = notify::Event::new(kind);
        for path in paths {
            event.paths.push(changes.root.join(path));
        }
        input.send(Ok(event)).unwrap();
        let (output, receiver) = mpsc::sync_channel(512);
        monitor(
            state,
            root,
            governor,
            cancelled,
            Arc::new(AtomicBool::new(true)),
            EventSender {
                inner: output,
                sequence: Arc::new(AtomicU64::new(0)),
            },
            &changes,
            None,
            policy,
        );
        receiver.try_iter().collect()
    }
    fn remember_paths(
        state: &mut State,
        root: &File,
        governor: &ResourceGovernor,
        cancelled: &AtomicBool,
        paths: &[&str],
    ) {
        for path in paths {
            state.validate(root, path, governor, cancelled).unwrap();
            state
                .remember(&observe(root, path, governor, cancelled).unwrap())
                .unwrap();
        }
    }
    #[test]
    fn namespace_refreshes_immediate_parent_and_pages_more_than_64_rows() {
        let (dir, root, governor, cancelled) = fixture();
        fs::create_dir_all(dir.path().join("ancestor/parent")).unwrap();
        let mut names = vec!["ancestor".to_string(), "ancestor/parent".to_string()];
        for n in 0..130 {
            let path = format!("ancestor/parent/file{n:03}");
            fs::write(dir.path().join(&path), "old").unwrap();
            names.push(path);
        }
        let mut state = State::new().unwrap();
        remember_paths(
            &mut state,
            &root,
            &governor,
            &cancelled,
            &names.iter().map(String::as_str).collect::<Vec<_>>(),
        );
        // Every sibling now differs, exercising all three 64-row pages.
        for path in names.iter().skip(2) {
            fs::write(dir.path().join(path), "new payload").unwrap();
        }
        fs::write(dir.path().join("ancestor/parent/added"), "new").unwrap();
        let events = injected(
            &dir,
            root,
            governor,
            cancelled,
            Arc::new(Mutex::new(state)),
            test_policy(),
            notify::EventKind::Create(notify::event::CreateKind::File),
            &["ancestor/parent/added"],
        );
        let entries: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                Event::Entry { entry } => Some(entry.path.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(entries.len(), 132); // New child + immediate parent + 130 siblings.
        assert!(entries.contains(&"ancestor/parent"));
        assert!(!entries.contains(&"ancestor"));
    }
    #[test]
    fn pruned_namespace_refreshes_only_visible_parent_on_create_and_remove() {
        for excluded in [false, true] {
            let (dir, root, governor, cancelled) = fixture();
            fs::create_dir_all(dir.path().join("visible")).unwrap();
            fs::write(dir.path().join("visible/sibling"), "old").unwrap();
            let mut state = State::new().unwrap();
            remember_paths(
                &mut state,
                &root,
                &governor,
                &cancelled,
                &["visible", "visible/sibling"],
            );
            let state = Arc::new(Mutex::new(state));
            let policy = Arc::new(Policy {
                ignores: Arc::new(BackupIgnoreRules::new(if excluded {
                    ""
                } else {
                    "node_modules/"
                })),
                exclusions: if excluded {
                    vec![key("visible/node_modules"), key("node_modules")]
                } else {
                    vec![]
                },
                invalid: test_policy().invalid.clone(),
                receipts: None,
                cache: None,
            });
            fs::write(dir.path().join("visible/sibling"), "changed but unrelated").unwrap();
            fs::create_dir_all(dir.path().join("visible/node_modules/deep")).unwrap();
            fs::write(
                dir.path().join("visible/node_modules/deep/private"),
                "never indexed",
            )
            .unwrap();
            let mut versions = Vec::new();
            for remove in [false, true] {
                if remove {
                    fs::remove_dir_all(dir.path().join("visible/node_modules")).unwrap();
                }
                let kind = if remove {
                    notify::EventKind::Remove(notify::event::RemoveKind::Folder)
                } else {
                    notify::EventKind::Create(notify::event::CreateKind::Folder)
                };
                let events = injected(
                    &dir,
                    root.clone(),
                    governor.clone(),
                    cancelled.clone(),
                    state.clone(),
                    policy.clone(),
                    kind,
                    &["visible/node_modules"],
                );
                assert_eq!(events.len(), 1);
                match &events[0] {
                    Event::Entry { entry } => {
                        assert_eq!(entry.path, "visible");
                        versions.push(entry.version.clone());
                    }
                    _ => panic!("parent must be a fresh entry"),
                }
            }
            assert_ne!(versions[0], versions[1]);
            assert_eq!(
                state
                    .lock()
                    .unwrap()
                    .db
                    .query_row("SELECT count(*) FROM observed", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                2
            );
            // Root has no SyncEntry, even for an excluded root child.
            fs::create_dir(dir.path().join("node_modules")).unwrap();
            let events = injected(
                &dir,
                root,
                governor,
                cancelled,
                state,
                policy,
                notify::EventKind::Create(notify::event::CreateKind::Folder),
                &["node_modules"],
            );
            assert!(events.is_empty());
        }
    }
    #[test]
    fn rename_refreshes_both_parents_and_missing_or_symlink_parent_is_a_gap() {
        let (dir, root, governor, cancelled) = fixture();
        for path in ["left", "right"] {
            fs::create_dir(dir.path().join(path)).unwrap();
        }
        fs::write(dir.path().join("left/file"), "x").unwrap();
        let mut state = State::new().unwrap();
        remember_paths(
            &mut state,
            &root,
            &governor,
            &cancelled,
            &["left", "right", "left/file"],
        );
        let state = Arc::new(Mutex::new(state));
        fs::rename(dir.path().join("left/file"), dir.path().join("right/file")).unwrap();
        let events = injected(
            &dir,
            root.clone(),
            governor.clone(),
            cancelled.clone(),
            state.clone(),
            test_policy(),
            notify::EventKind::Modify(notify::event::ModifyKind::Name(
                notify::event::RenameMode::Both,
            )),
            &["left/file", "right/file"],
        );
        for path in ["left", "right"] {
            assert!(events
                .iter()
                .any(|e| matches!(e, Event::Entry {entry} if entry.path == path)));
        }
        fs::remove_dir(dir.path().join("left")).unwrap();
        for symlink in [false, true] {
            if symlink {
                std::os::unix::fs::symlink(dir.path().join("right"), dir.path().join("left"))
                    .unwrap();
            }
            let events = injected(
                &dir,
                root.clone(),
                governor.clone(),
                cancelled.clone(),
                state.clone(),
                test_policy(),
                notify::EventKind::Remove(notify::event::RemoveKind::File),
                &["left/file"],
            );
            assert!(!events
                .iter()
                .any(|e| matches!(e, Event::Entry {entry} if entry.path == "left")));
            assert!(
                !events.is_empty(),
                "unavailable parent retains a coverage gap"
            );
        }
    }
    #[test]
    fn private_cache_events_are_pruned_before_index_queries() {
        let (dir, root, _, _) = fixture();
        fs::create_dir_all(dir.path().join("Library/Caches/ThingtimeFolderInventories")).unwrap();
        fs::write(
            dir.path()
                .join("Library/Caches/ThingtimeFolderInventories/inventory.sqlite-wal"),
            "state",
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("ignored/deep")).unwrap();
        let policy = Policy {
            ignores: Arc::new(BackupIgnoreRules::new("ignored/")),
            exclusions: vec![key("Library/Caches/ThingtimeFolderInventories")],
            invalid: test_policy().invalid.clone(),
            receipts: None,
            cache: None,
        };
        assert!(policy.pruned_event(
            &root,
            "Library/Caches/ThingtimeFolderInventories/inventory.sqlite-wal"
        ));
        assert!(policy.pruned_event(
            &root,
            "Library/Caches/ThingtimeFolderInventories/removed-wal"
        ));
        assert!(policy.pruned_event(&root, "ignored/deep/removed"));
        assert!(!policy.pruned_event(&root, "ordinary-removed"));
    }
    #[test]
    fn first_namespace_gate_does_not_visit_later_subtrees() {
        let (dir, root, governor, cancelled) = fixture();
        fs::write(dir.path().join("first"), "ready").unwrap();
        fs::create_dir(dir.path().join("later")).unwrap();
        fs::write(dir.path().join("later/child"), "later").unwrap();
        let mut state = State::new().unwrap();
        state
            .validate(&root, "first", &governor, &cancelled)
            .unwrap();
        let parents: i64 = state
            .db
            .query_row("SELECT count(*) FROM dirs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            parents, 1,
            "first eligible row must not wait for later subtree enumeration"
        );
        let entry = observe(&root, "first", &governor, &cancelled).unwrap();
        state.remember(&entry).unwrap();
    }
    #[test]
    fn sibling_and_ancestor_aliases_are_both_ineligible() {
        let (dir, root, governor, cancelled) = fixture();
        fs::create_dir(dir.path().join("Alpha")).unwrap();
        if fs::create_dir(dir.path().join("alpha")).is_err() {
            return;
        }
        // Case-insensitive filesystems cannot construct this fixture.
        if fs::read_dir(dir.path()).unwrap().count() != 2 {
            return;
        }
        fs::write(dir.path().join("Alpha/child"), "x").unwrap();
        let mut state = State::new().unwrap();
        for path in ["Alpha", "alpha", "Alpha/child"] {
            assert_eq!(
                state.validate(&root, path, &governor, &cancelled),
                Err("collision")
            );
        }
    }
    #[test]
    fn native_notifications_reobserve_indexed_revision_while_scan_is_active() {
        let (dir, root, governor, cancelled) = fixture();
        fs::write(dir.path().join("first"), "one").unwrap();
        let changes = watch(dir.path()).unwrap();
        let mut state = State::new().unwrap();
        state
            .validate(&root, "first", &governor, &cancelled)
            .unwrap();
        let entry = observe(&root, "first", &governor, &cancelled).unwrap();
        let original = entry.version.clone();
        state.remember(&entry).unwrap();
        let state = Arc::new(Mutex::new(state));
        let finished = Arc::new(AtomicBool::new(false));
        let (sender, receiver) = mpsc::sync_channel(64);
        let sender = EventSender {
            inner: sender,
            sequence: Arc::new(AtomicU64::new(0)),
        };
        std::thread::scope(|scope| {
            let finished_worker = finished.clone();
            scope.spawn(|| {
                monitor(
                    state,
                    root,
                    governor,
                    cancelled,
                    finished_worker,
                    sender,
                    &changes,
                    None,
                    test_policy(),
                )
            });
            fs::write(dir.path().join("first"), "changed revision").unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let mut seen = false;
            while std::time::Instant::now() < deadline {
                if let Ok(Event::Entry { entry }) =
                    receiver.recv_timeout(Duration::from_millis(100))
                {
                    if entry.path == "first" && entry.version != original {
                        seen = true;
                        break;
                    }
                }
            }
            finished.store(true, Ordering::Relaxed);
            assert!(seen, "no changed revision before scan completion");
        });
    }
    #[test]
    fn notification_monitor_stops_on_cancellation() {
        let (dir, root, governor, cancelled) = fixture();
        let changes = watch(dir.path()).unwrap();
        let (sender, _) = mpsc::sync_channel(1);
        let sender = EventSender {
            inner: sender,
            sequence: Arc::new(AtomicU64::new(0)),
        };
        cancelled.store(true, Ordering::Relaxed);
        monitor(
            Arc::new(Mutex::new(State::new().unwrap())),
            root,
            governor,
            cancelled,
            Arc::new(AtomicBool::new(false)),
            sender,
            &changes,
            None,
            test_policy(),
        );
    }
}

#[cfg(test)]
mod strict_backend_tests {
    use super::*;
    #[test]
    fn polling_never_qualifies_for_strict_seal() {
        assert!(!strict_backend(notify::WatcherKind::PollWatcher));
        assert!(strict_backend(notify::WatcherKind::Fsevent));
        assert!(strict_backend(notify::WatcherKind::Inotify));
    }
}
