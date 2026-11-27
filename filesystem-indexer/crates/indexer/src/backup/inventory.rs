//! Scoped sync coverage and physical content observations in the search index
//! database. The private host supplies an already authorized scope and root.
use super::*;
use crate::{now_ms, retry_database_busy, IndexDatabase};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use rustix::fs::{flock, FlockOperation};
use serde_json::{json, Value};

mod photo;

const VERSION: u32 = 1;
const SCHEMA_VERSION: u32 = 2;
const PAGE_LIMIT: usize = 512;
const SYNC_SCAN_BYTES_PER_SECOND: f64 = 625_000.0;
const SYNC_CPU_PERCENT: usize = 15;
const PARTS_ALGORITHM: &str = "sha256-parts-v1";

pub(crate) fn initialize(connection: &Connection) -> Result<(), IndexerError> {
    let version = || {
        connection
            .query_row(
                "SELECT value FROM metadata WHERE key='inventory_schema_version'",
                [],
                |r| r.get::<_, u32>(0),
            )
            .optional()
    };
    if retry_database_busy(version)?.is_none() {
        retry_database_busy(|| {
            connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS inventory_scopes(
                id INTEGER PRIMARY KEY, origin TEXT NOT NULL, account TEXT NOT NULL,
                device TEXT NOT NULL, root_id TEXT NOT NULL, watcher_cursor INTEGER NOT NULL DEFAULT 0,
                UNIQUE(origin,account,device,root_id)
            );
            CREATE TABLE IF NOT EXISTS inventory_generations(
                id INTEGER PRIMARY KEY, scope INTEGER NOT NULL REFERENCES inventory_scopes(id),
                generation TEXT NOT NULL, mode TEXT NOT NULL, coverage TEXT NOT NULL,
                root TEXT NOT NULL, root_identity TEXT NOT NULL, root_stamp TEXT NOT NULL,
                mount TEXT, watcher_cursor INTEGER NOT NULL, entry_count INTEGER NOT NULL DEFAULT 0,
                gap_count INTEGER NOT NULL DEFAULT 0, ignored_count INTEGER NOT NULL DEFAULT 0,
                indexed INTEGER NOT NULL DEFAULT 0, excludes TEXT NOT NULL, ignores TEXT, native_receipts TEXT, created_ms INTEGER NOT NULL,
                UNIQUE(scope,generation)
            );
            CREATE INDEX IF NOT EXISTS inventory_generation_latest ON inventory_generations(scope,id DESC);
            CREATE TABLE IF NOT EXISTS inventory_entries(
                generation INTEGER NOT NULL REFERENCES inventory_generations(id),
                path TEXT NOT NULL, parent TEXT NOT NULL, version TEXT NOT NULL,
                identity TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(generation,path)
            ) WITHOUT ROWID;
            CREATE INDEX IF NOT EXISTS inventory_children ON inventory_entries(generation,parent,path);
            CREATE TABLE IF NOT EXISTS inventory_omissions(
                generation INTEGER NOT NULL REFERENCES inventory_generations(id),
                path TEXT NOT NULL, version TEXT NOT NULL, PRIMARY KEY(generation,path)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS inventory_ordinals(
                generation INTEGER NOT NULL REFERENCES inventory_generations(id),
                ordinal INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(generation,ordinal)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS inventory_names(
                generation INTEGER NOT NULL REFERENCES inventory_generations(id),
                canonical TEXT NOT NULL, PRIMARY KEY(generation,canonical)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS inventory_identities(
                generation INTEGER NOT NULL REFERENCES inventory_generations(id),
                identity TEXT NOT NULL, PRIMARY KEY(generation,identity)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS inventory_directories(
                generation INTEGER NOT NULL REFERENCES inventory_generations(id),
                path TEXT NOT NULL, stamp TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(generation,path)
            ) WITHOUT ROWID;
            CREATE INDEX IF NOT EXISTS inventory_pending ON inventory_directories(generation,pending,path);
            CREATE TABLE IF NOT EXISTS inventory_revisions(
                generation INTEGER NOT NULL REFERENCES inventory_generations(id),
                sequence INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(generation,sequence)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS inventory_gaps(
                sequence INTEGER PRIMARY KEY, generation INTEGER NOT NULL REFERENCES inventory_generations(id),
                ordinal INTEGER NOT NULL, path TEXT, reason TEXT NOT NULL, coverage TEXT NOT NULL, UNIQUE(generation,ordinal)
            );
            CREATE INDEX IF NOT EXISTS inventory_gap_page ON inventory_gaps(generation,sequence);
            CREATE TABLE IF NOT EXISTS inventory_photo_observations(
                scope INTEGER NOT NULL REFERENCES inventory_scopes(id),
                resource_id TEXT NOT NULL, resource_revision TEXT NOT NULL, watcher_cursor INTEGER NOT NULL,
                data TEXT NOT NULL, PRIMARY KEY(scope,resource_id)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS inventory_fingerprints(
                mount TEXT NOT NULL, stamp TEXT NOT NULL, algorithm TEXT NOT NULL, digest TEXT NOT NULL,
                PRIMARY KEY(mount,stamp,algorithm)
            ) WITHOUT ROWID;
            INSERT INTO metadata(key,value) VALUES('inventory_cache_epoch',0) ON CONFLICT DO NOTHING;
            INSERT INTO metadata(key,value) VALUES('inventory_schema_version',1) ON CONFLICT DO NOTHING;"
        )
        })?;
    }
    if retry_database_busy(version)? == Some(1) {
        retry_database_busy(|| live_children::initialize(connection))?;
    }
    if retry_database_busy(version)? != Some(SCHEMA_VERSION) {
        return Err(failure("unsupported_inventory_schema"));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    origin: String,
    account_id: String,
    device_id: String,
    root_id: String,
}
impl Scope {
    fn validate(&self) -> Result<(), IndexerError> {
        if [
            &self.origin,
            &self.account_id,
            &self.device_id,
            &self.root_id,
        ]
        .iter()
        .any(|v| !valid_label(v))
        {
            return Err(failure("invalid_scope"));
        }
        Ok(())
    }
    fn lookup(&self, db: &Connection) -> rusqlite::Result<Option<i64>> {
        db.query_row("SELECT id FROM inventory_scopes WHERE origin=?1 AND account=?2 AND device=?3 AND root_id=?4",
            params![self.origin,self.account_id,self.device_id,self.root_id], |r| r.get(0)).optional()
    }
    fn ensure(&self, db: &Connection) -> rusqlite::Result<i64> {
        db.execute("INSERT INTO inventory_scopes(origin,account,device,root_id) VALUES(?1,?2,?3,?4) ON CONFLICT DO NOTHING",
            params![self.origin,self.account_id,self.device_id,self.root_id])?;
        self.lookup(db)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }
}
fn valid_label(s: &str) -> bool {
    !s.is_empty() && s.len() <= 1024 && !s.chars().any(char::is_control)
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(super) enum ModeKind {
    Strict,
    Backup,
}
impl ModeKind {
    fn name(self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::Backup => "backup",
        }
    }
}

fn default_sync_limits() -> IndexResourceLimits {
    IndexResourceLimits {
        max_cpu_percent: SYNC_CPU_PERCENT,
        ..IndexResourceLimits::default()
    }
}

pub(super) fn decode_sync_limits(
    mut value: Value,
) -> Result<IndexResourceLimits, serde_json::Error> {
    if let Some(limits) = value.as_object_mut() {
        limits
            .entry("maxCpuPercent")
            .or_insert_with(|| json!(SYNC_CPU_PERCENT));
    }
    serde_json::from_value(value)
}

fn deserialize_sync_limits<'de, D>(deserializer: D) -> Result<IndexResourceLimits, D::Error>
where
    D: serde::Deserializer<'de>,
{
    decode_sync_limits(Value::deserialize(deserializer)?).map_err(serde::de::Error::custom)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Command {
    version: u32,
    operation: String,
    scope: Option<Scope>,
    #[serde(default)]
    paths: Vec<PathBuf>,
    #[serde(default)]
    lost_events: bool,
    offset: Option<usize>,
    hidden: Option<bool>,
    directory_version: Option<String>,
    generation: Option<String>,
    mode: Option<ModeKind>,
    root: Option<PathBuf>,
    root_identity: Option<String>,
    native_receipt_directory: Option<PathBuf>,
    #[serde(default = "default_cpu_shares")]
    cpu_budget_shares: usize,
    #[serde(default)]
    excluded_paths: Vec<String>,
    ignore_rules: Option<String>,
    #[serde(
        default = "default_sync_limits",
        deserialize_with = "deserialize_sync_limits"
    )]
    resource_limits: IndexResourceLimits,
    #[serde(default)]
    resource_feedback: bool,
    scan_bytes_per_second: Option<f64>,
    after: Option<String>,
    parent: Option<String>,
    path: Option<String>,
    resource_identity: Option<String>,
    resource_revision: Option<String>,
    resource_path: Option<String>,
    #[serde(default)]
    resources: Vec<photo::ResourceKey>,
    total_entries: Option<u64>,
    total_gaps: Option<u64>,
    limit: Option<usize>,
    after_sequence: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    #[serde(skip)]
    id: i64,
    generation: String,
    mode: String,
    coverage: String,
    entry_count: u64,
    gap_count: u64,
    ignored_count: u64,
    #[serde(rename = "rootVersion")]
    root_stamp: String,
    state: String,
    revision: u64,
    watcher_cursor: u64,
    #[serde(skip)]
    root: String,
    #[serde(skip)]
    root_identity: String,
    #[serde(skip)]
    mount: Option<String>,
    #[serde(skip)]
    excludes: String,
    #[serde(skip)]
    ignores: Option<String>,
    #[serde(skip)]
    native_receipts: Option<String>,
}
fn status(
    db: &Connection,
    scope: &Scope,
    generation: Option<&str>,
) -> Result<Option<Status>, IndexerError> {
    let Some(scope_id) = scope.lookup(db)? else {
        return Ok(None);
    };
    Ok(db.query_row("SELECT g.id,g.generation,g.mode,
            CASE WHEN g.mode<>'backup' AND s.watcher_cursor<>g.watcher_cursor THEN 'invalidated' ELSE g.coverage END,
            g.entry_count,g.gap_count,g.watcher_cursor,g.root,g.root_identity,g.root_stamp,g.mount,g.ignored_count,
            CASE WHEN (g.mode<>'backup' AND s.watcher_cursor<>g.watcher_cursor) OR g.coverage IN ('invalidated','cancelled') THEN 'interrupted'
                 WHEN g.coverage IN ('sealed','provisional','prepared') THEN 'complete'
                 WHEN g.indexed<>0 THEN 'indexed' ELSE 'running' END,
            coalesce((SELECT max(sequence) FROM inventory_revisions WHERE generation=g.id),0),g.excludes,g.ignores,g.native_receipts
            FROM inventory_generations g JOIN inventory_scopes s ON s.id=g.scope
            WHERE g.scope=?1 AND (?2 IS NULL OR g.generation=?2) ORDER BY g.id DESC LIMIT 1",
        params![scope_id,generation], |r| Ok(Status {id:r.get(0)?,generation:r.get(1)?,mode:r.get(2)?,coverage:r.get(3)?,entry_count:r.get(4)?,gap_count:r.get(5)?,watcher_cursor:r.get(6)?,root:r.get(7)?,root_identity:r.get(8)?,root_stamp:r.get(9)?,mount:r.get(10)?,ignored_count:r.get(11)?,state:r.get(12)?,revision:r.get(13)?,excludes:r.get(14)?,ignores:r.get(15)?,native_receipts:r.get(16)?})).optional()?)
}

// A host can use the same functions in-process later. The CLI never accepts a
// database or authorization scope from a browser, network socket or scan row.
pub fn serve(
    database_path: &Path,
    input: impl BufRead,
    output: impl Write,
) -> Result<(), IndexerError> {
    serve_with_cancellation(
        database_path,
        input,
        output,
        Arc::new(AtomicBool::new(false)),
    )
}

pub fn serve_with_cancellation(
    database_path: &Path,
    mut input: impl BufRead,
    mut output: impl Write,
    cancelled: Arc<AtomicBool>,
) -> Result<(), IndexerError> {
    if cancelled.load(Ordering::Relaxed) {
        return Err(failure("capture_cancelled"));
    }
    let line = read_request_line(&mut input)?;
    let command: Command = serde_json::from_slice(&line).map_err(|_| failure("invalid_request"))?;
    if command.version != VERSION || command.generation.as_ref().is_some_and(|g| !valid_label(g)) {
        return Err(failure("invalid_request"));
    }
    if command.operation == "capabilities" {
        if let Some(path) = command.root {
            let root = open_root(&path)?;
            if command.root_identity.as_deref() != Some(identity(&root.metadata()?).as_str()) {
                return Err(failure("source_changed"));
            }
            require_strict_volume(&root)?;
        }
        return write_value(
            &mut output,
            &json!({"version":VERSION,"strictCoverage":streaming::supports_strict()}),
        );
    }
    let mut database = IndexDatabase::open(database_path)?;
    if command.operation == "invalidatePaths" {
        return write_value(
            &mut output,
            &json!({"invalidatedScopes":invalidate_paths(&mut database.connection,&command.paths,command.lost_events)?}),
        );
    }
    if command.operation == "listChildren" {
        let root = command.root.ok_or_else(|| failure("invalid_request"))?;
        let identity = command
            .root_identity
            .ok_or_else(|| failure("invalid_request"))?;
        let parent = command.parent.as_deref().unwrap_or("");
        if !parent.is_empty() && !valid_path(parent) {
            return Err(failure("invalid_request"));
        }
        return write_value(
            &mut output,
            &live_children::list(
                &mut database.connection,
                live_children::Listing {
                    root: &root,
                    root_identity: &identity,
                    parent,
                    after: command.after.as_deref(),
                    offset: command.offset,
                    hidden: command.hidden,
                    expected_version: command.directory_version.as_deref(),
                    limit: requested_limit(command.limit)?,
                },
                &command.resource_limits,
                cancelled,
            )?,
        );
    }
    let scope = command.scope.ok_or_else(|| failure("invalid_scope"))?;
    scope.validate()?;
    if command.operation == "photoObservations" {
        let values = photo::lookup(&mut database.connection, &scope, &command.resources)?;
        return write_value(&mut output, &values);
    }
    if command.operation == "photoObservation" {
        let key = photo::ResourceKey {
            resource_identity: command
                .resource_identity
                .ok_or_else(|| failure("invalid_request"))?,
            resource_revision: command
                .resource_revision
                .ok_or_else(|| failure("invalid_request"))?,
        };
        let result = photo::lookup(&mut database.connection, &scope, &[key])?
            .pop()
            .flatten();
        return write_value(&mut output, &result);
    }
    if command.operation == "observe" {
        let root_path = command.root.ok_or_else(|| failure("invalid_request"))?;
        let root_identity = command
            .root_identity
            .ok_or_else(|| failure("invalid_request"))?;
        let path = command
            .path
            .filter(|path| valid_path(path))
            .ok_or_else(|| failure("invalid_request"))?;
        let _admission = admit(database_path)?;
        let root = open_root(&root_path)?;
        let metadata = root.metadata()?;
        if identity(&metadata) != root_identity {
            return Err(failure("source_changed"));
        }
        let version = stamp(&metadata);
        let mount = mount_identity(&root);
        let governor = sync_governor(
            command.resource_limits,
            command.scan_bytes_per_second,
            command.cpu_budget_shares,
        )?;
        let cache = Cache::new(database_path)?;
        let entry = observe_cached(
            &root,
            &path,
            &governor,
            &cancelled,
            Some(&cache),
            mount.as_deref(),
        )
        .map_err(failure)?;
        let reopened = open_root(&root_path)?;
        if stamp(&reopened.metadata()?) != version
            || mount_identity(&reopened) != mount
            || cancelled.load(Ordering::Relaxed)
        {
            return Err(failure("source_changed"));
        }
        match (
            command.resource_identity,
            command.resource_revision,
            command.resource_path,
        ) {
            (None, None, None) => (),
            (Some(identity), Some(revision), Some(path))
                if valid_label(&identity) && valid_label(&revision) && valid_path(&path) =>
            {
                store_photo_observation(
                    &mut database.connection,
                    &scope,
                    &identity,
                    &revision,
                    &path,
                    &entry,
                )?;
            }
            _ => return Err(failure("invalid_request")),
        }
        return write_value(&mut output, &entry);
    }
    if command.operation == "scan" {
        let mode = command.mode.ok_or_else(|| failure("invalid_request"))?;
        let request = Request {
            version: VERSION,
            streaming: false,
            root: command.root.ok_or_else(|| failure("invalid_request"))?,
            root_identity: command
                .root_identity
                .ok_or_else(|| failure("invalid_request"))?,
            excluded_paths: command.excluded_paths,
            ignore_rules: command.ignore_rules,
            resource_limits: command.resource_limits,
            resource_feedback: command.resource_feedback,
            cpu_budget_shares: command.cpu_budget_shares,
            scan_bytes_per_second: command.scan_bytes_per_second,
        };
        return scan(
            database_path,
            request,
            scope,
            command.generation,
            mode,
            None,
            command.native_receipt_directory,
            cancelled,
            |event| write_value(&mut output, &event),
        );
    }
    let generation = command.generation.as_deref();
    if command.operation == "beginPhotoCapture" {
        let generation = generation.ok_or_else(|| failure("invalid_request"))?;
        let revision = command
            .resource_revision
            .as_deref()
            .filter(|value| valid_label(value))
            .ok_or_else(|| failure("invalid_request"))?;
        photo::begin(&mut database.connection, &scope, generation, revision)?;
        return write_value(
            &mut output,
            &status(&database.connection, &scope, Some(generation))?,
        );
    }
    if command.operation == "status" {
        return write_value(
            &mut output,
            &status(&database.connection, &scope, generation)?,
        );
    }
    if command.operation == "invalidate" && generation.is_none() {
        let tx = database
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(scope_id) = scope.lookup(&tx)? {
            tx.execute(
                "UPDATE inventory_scopes SET watcher_cursor=watcher_cursor+1 WHERE id=?1",
                [scope_id],
            )?;
            tx.execute("UPDATE inventory_generations SET coverage='invalidated' WHERE scope=?1 AND mode='backup' AND coverage NOT IN ('invalidated','cancelled')",[scope_id])?;
        }
        tx.commit()?;
        return write_value(&mut output, &status(&database.connection, &scope, None)?);
    }
    let generation = generation.ok_or_else(|| failure("invalid_request"))?;
    let current = status(&database.connection, &scope, Some(generation))?
        .ok_or_else(|| failure("generation_unavailable"))?;
    match command.operation.as_str() {
        "appendPhotoCapture" => {
            photo::append(&mut database.connection, &current, &command.resources)?;
            write_value(
                &mut output,
                &status(&database.connection, &scope, Some(generation))?,
            )
        }
        "appendPhotoCloudGaps" => {
            photo::append_cloud_gaps(&mut database.connection, &current, &command.paths)?;
            write_value(
                &mut output,
                &status(&database.connection, &scope, Some(generation))?,
            )
        }
        "sealPhotoCapture" => {
            if current.mode != "photo"
                || !matches!(current.coverage.as_str(), "scanning" | "sealed")
                || command.resource_revision.as_deref() != Some(current.root_stamp.as_str())
                || command.total_entries != Some(current.entry_count)
                || command.total_gaps.unwrap_or(0) != current.gap_count
            {
                return Err(failure("generation_unavailable"));
            }
            if current.coverage == "scanning" {
                finalize_ordinal_page(
                    &mut database.connection,
                    current.id,
                    "sealed",
                    command.total_entries,
                )?;
            }
            write_value(
                &mut output,
                &status(&database.connection, &scope, Some(generation))?,
            )
        }
        "discardPhotoCapture" => {
            if current.mode != "photo" {
                return Err(failure("generation_unavailable"));
            }
            database.connection.execute(
                "UPDATE inventory_generations SET coverage='invalidated' WHERE id=?1",
                [current.id],
            )?;
            write_value(
                &mut output,
                &status(&database.connection, &scope, Some(generation))?,
            )
        }
        "page" | "photoPage" if (command.operation == "photoPage") == (current.mode == "photo") => {
            page(
                &mut database.connection,
                current,
                command.after.as_deref(),
                command.parent.as_deref(),
                command.offset,
                command.limit,
                &mut output,
            )
        }
        "ack" => {
            if current.mode != "backup"
                || current.state != "indexed"
                || command
                    .after_sequence
                    .and_then(|seq| u64::try_from(seq).ok())
                    != Some(current.revision)
            {
                return Err(failure("revision_changed"));
            }
            write_value(&mut output, &current)
        }
        "changes" => change_page(
            &mut database.connection,
            current,
            command.after_sequence.unwrap_or(0),
            command.limit,
            &mut output,
        ),
        "gaps" => gaps(
            &mut database.connection,
            current,
            command.after_sequence,
            command.offset,
            command.limit,
            &mut output,
        ),
        "seal" => {
            let root = command.root.ok_or_else(|| failure("invalid_request"))?;
            let root_identity = command
                .root_identity
                .ok_or_else(|| failure("invalid_request"))?;
            let _admission = admit(database_path)?;
            let current = status(&database.connection, &scope, Some(generation))?
                .ok_or_else(|| failure("generation_unavailable"))?;
            let governor = sync_governor(
                command.resource_limits,
                command.scan_bytes_per_second,
                command.cpu_budget_shares,
            )?;
            if command
                .native_receipt_directory
                .as_deref()
                .and_then(Path::to_str)
                != current.native_receipts.as_deref()
            {
                return Err(failure("generation_unavailable"));
            }
            let receipts = open_receipts(command.native_receipt_directory.as_deref())?;
            let mut failure_path = None;
            if let Err(error) = seal(
                &mut database.connection,
                &current,
                &root,
                &root_identity,
                &governor,
                &cancelled,
                receipts.as_deref(),
                &mut failure_path,
                |_| {},
            ) {
                if current.coverage == "prepared" && error.code != "database_error" {
                    database.connection.execute("UPDATE inventory_generations SET coverage='invalidated' WHERE id=?1 AND coverage='prepared'", [current.id])?;
                }
                if let Some((path, scope)) = failure_path {
                    if !matches!(error.code, "capture_cancelled" | "database_error") {
                        write_value(
                            &mut output,
                            &Event::Skipped {
                                gap: Gap {
                                    path: Some(path),
                                    reason: "changed",
                                    scope,
                                },
                            },
                        )?;
                    }
                }
                return Err(error);
            }
            write_value(
                &mut output,
                &status(&database.connection, &scope, Some(generation))?,
            )
        }
        "cancel" | "invalidate" => {
            let cancelled = command.operation == "cancel";
            database.connection.execute(
                "UPDATE inventory_generations SET coverage=?2 WHERE id=?1
                AND coverage NOT IN ('cancelled','invalidated') AND (?3=0 OR coverage<>'sealed')",
                params![
                    current.id,
                    if cancelled {
                        "cancelled"
                    } else {
                        "invalidated"
                    },
                    cancelled
                ],
            )?;
            write_value(
                &mut output,
                &status(&database.connection, &scope, Some(generation))?,
            )
        }
        _ => Err(failure("invalid_request")),
    }
}

fn store_photo_observation(
    db: &mut Connection,
    scope: &Scope,
    identity: &str,
    revision: &str,
    path: &str,
    entry: &Entry,
) -> Result<(), IndexerError> {
    if entry.kind != "file" || entry.symbolic_link.is_some() {
        return Err(failure("invalid_request"));
    }
    let digest = entry
        .sha256
        .as_deref()
        .or_else(|| entry.fingerprint.as_ref().map(|fp| fp.sha256.as_str()))
        .ok_or_else(|| failure("inventory_unavailable"))?;
    let version = format!(
        "{:x}",
        Sha256::digest(format!("{revision}:{}:{digest}", entry.size).as_bytes())
    );
    let mut data = json!({"id":identity,"version":version,"path":path,"kind":"file","size":entry.size,"sha256":entry.sha256});
    if let Some(fingerprint) = entry.fingerprint.as_ref() {
        data["fingerprint"] = json!(fingerprint);
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let scope_id = scope.ensure(&tx)?;
    tx.execute("INSERT INTO inventory_photo_observations(scope,resource_id,resource_revision,watcher_cursor,data)
        SELECT id,?2,?3,watcher_cursor,?4 FROM inventory_scopes WHERE id=?1
        ON CONFLICT(scope,resource_id) DO UPDATE SET resource_revision=excluded.resource_revision,watcher_cursor=excluded.watcher_cursor,data=excluded.data",params![scope_id,identity,revision,data.to_string()])?;
    tx.commit()?;
    Ok(())
}

pub(super) fn read_request_line(input: &mut impl BufRead) -> Result<Vec<u8>, IndexerError> {
    let mut line = Vec::new();
    input
        .take(2 * 1024 * 1024)
        .read_until(b'\n', &mut line)
        .map_err(|_| failure("invalid_request"))?;
    if line.is_empty() || line.len() >= 2 * 1024 * 1024 {
        return Err(failure("invalid_request"));
    }
    Ok(line)
}

fn write_value(output: &mut impl Write, value: &impl Serialize) -> Result<(), IndexerError> {
    serde_json::to_writer(&mut *output, value).map_err(|_| failure("output_closed"))?;
    output
        .write_all(b"\n")
        .map_err(|_| failure("output_closed"))?;
    output.flush().map_err(|_| failure("output_closed"))
}

// Hold a per-store kernel lock for the whole sync scan/seal. It is separate
// from SQLite locks, doesn't affect search, and dies with a crashed process.
// Admission is intentionally serial so separately launched helpers cannot
// multiply the configured device scan or CPU budget.
fn admit(database: &Path) -> Result<File, IndexerError> {
    let canonical = database
        .canonicalize()
        .map_err(|_| failure("inventory_unavailable"))?;
    let mut lock = canonical.into_os_string();
    lock.push(".sync-admission");
    let file = File::from(
        open(
            PathBuf::from(lock),
            OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| failure("inventory_unavailable"))?,
    );
    flock(&file, FlockOperation::NonBlockingLockExclusive)
        .map_err(|_| failure("inventory_busy"))?;
    Ok(file)
}

fn sync_scan_rate(requested: Option<f64>) -> f64 {
    requested.unwrap_or(SYNC_SCAN_BYTES_PER_SECOND)
}

fn sync_governor(
    limits: IndexResourceLimits,
    rate: Option<f64>,
    shares: usize,
) -> Result<ResourceGovernor, IndexerError> {
    if ![1, 3].contains(&shares) || rate.is_some_and(|v| !v.is_finite() || v < 1.0) {
        return Err(failure("invalid_configuration"));
    }
    let governor = ResourceGovernor::new_with_cpu_share(&limits, shares)?;
    governor.set_scan_rate(Some(sync_scan_rate(rate)));
    Ok(governor)
}

#[cfg(target_vendor = "apple")]
pub(super) fn mount_identity(file: &File) -> Option<String> {
    let info = rustix::fs::fstatfs(file).ok()?;
    Some(format!("darwin:{:?}", info.f_fsid))
}
#[cfg(target_os = "linux")]
pub(super) fn mount_identity(file: &File) -> Option<String> {
    static BOOT: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    let boot = BOOT
        .get_or_init(|| std::fs::read_to_string("/proc/sys/kernel/random/boot_id").ok())
        .as_ref()?;
    let stat = rustix::fs::statx(
        file,
        "",
        AtFlags::EMPTY_PATH,
        rustix::fs::StatxFlags::MNT_ID,
    )
    .ok()?;
    (stat.stx_mask & rustix::fs::StatxFlags::MNT_ID.bits() != 0)
        .then(|| format!("linux:{}:{}", boot.trim(), stat.stx_mnt_id))
}
#[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
pub(super) fn mount_identity(_file: &File) -> Option<String> {
    None
}

pub(super) struct Cache(Mutex<Connection>, i64);
impl Cache {
    fn new(path: &Path) -> Result<Self, IndexerError> {
        let db = IndexDatabase::open_reader(path)?.connection;
        let epoch = db.query_row(
            "SELECT value FROM metadata WHERE key='inventory_cache_epoch'",
            [],
            |r| r.get(0),
        )?;
        Ok(Self(Mutex::new(db), epoch))
    }
    pub(super) fn get(&self, mount: &str, version: &str) -> Option<String> {
        let scoped_mount = format!("{}:{mount}", self.1);
        self.0.lock().ok()?.query_row("SELECT digest FROM inventory_fingerprints WHERE mount=?1 AND stamp=?2 AND algorithm=?3", params![scoped_mount,version,PARTS_ALGORITHM], |r| r.get(0)).ok()
    }
    pub(super) fn put(&self, mount: &str, version: &str, digest: &str) {
        let scoped_mount = format!("{}:{mount}", self.1);
        if let Ok(db) = self.0.lock() {
            let _ = db.execute("INSERT INTO inventory_fingerprints(mount,stamp,algorithm,digest) VALUES(?1,?2,?3,?4) ON CONFLICT DO NOTHING", params![scoped_mount,version,PARTS_ALGORITHM,digest]);
        }
    }
}

fn open_receipts(
    path: Option<&Path>,
) -> Result<Option<Arc<native_receipts::Receipts>>, IndexerError> {
    path.map(|path| native_receipts::Receipts::new(path).map(Arc::new))
        .transpose()
}

// The presence of nanosecond fields in stat does not establish their
// resolution. Only allow known local filesystems with reliable change stamps.
#[cfg(target_vendor = "apple")]
fn precise_apple_fs(name: &[libc::c_char], local: bool) -> bool {
    local
        && name
            .iter()
            .take_while(|&&byte| byte != 0)
            .map(|&byte| byte as u8)
            .eq(b"apfs".iter().copied())
}

#[cfg(target_os = "linux")]
fn precise_linux_fs(magic: u64) -> bool {
    // XFS, Btrfs and tmpfs. The shared ext2/3/4 magic cannot establish
    // the on-disk inode timestamp precision. Overlay and remote FS vary.
    matches!(magic, 0x5846_5342 | 0x9123_683e | 0x0102_1994)
}

pub(super) fn has_precise_stamps(file: &File) -> bool {
    #[cfg(target_vendor = "apple")]
    return rustix::fs::fstatfs(file).is_ok_and(|info| {
        precise_apple_fs(
            &info.f_fstypename,
            info.f_flags & libc::MNT_LOCAL as u32 != 0,
        )
    });
    #[cfg(target_os = "linux")]
    return rustix::fs::fstatfs(file).is_ok_and(|info| precise_linux_fs(info.f_type as u64));
    #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
    {
        let _ = file;
        false
    }
}

fn require_strict_volume(root: &File) -> Result<(), IndexerError> {
    if !streaming::supports_strict() {
        return Err(failure("strict_watcher_unavailable"));
    }
    if !has_precise_stamps(root) {
        return Err(failure("strict_volume_unavailable"));
    }
    Ok(())
}

pub(crate) fn open_root(path: &Path) -> Result<File, IndexerError> {
    let relative = path
        .strip_prefix("/")
        .map_err(|_| failure("invalid_request"))?;
    let relative = relative
        .to_str()
        .ok_or_else(|| failure("invalid_request"))?;
    if !relative.is_empty()
        && relative
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err(failure("invalid_request"));
    }
    #[cfg(target_vendor = "apple")]
    {
        // A security-scoped grant can permit the selected folder without
        // permitting read descriptors for its ancestors. Darwin checks all
        // absolute path components for links in a single kernel open.
        // NOFOLLOW_ANY includes the final component; combining the two
        // flags is rejected by Darwin with EINVAL.
        let flags = OFlags::RDONLY
            | OFlags::DIRECTORY
            | OFlags::CLOEXEC
            | OFlags::from_bits_retain(libc::O_NOFOLLOW_ANY as _);
        Ok(File::from(
            open(path, flags, Mode::empty()).map_err(|_| failure("source_changed"))?,
        ))
    }
    #[cfg(not(target_vendor = "apple"))]
    {
        let root = File::from(
            open(
                "/",
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| failure("source_unavailable"))?,
        );
        if relative.is_empty() {
            return Ok(root);
        }
        let root = open_path(&root, relative).map_err(|_| failure("source_changed"))?;
        if !root.metadata()?.is_dir() {
            return Err(failure("source_changed"));
        }
        Ok(root)
    }
}

fn begin(
    db: &mut Connection,
    scope: &Scope,
    generation: Option<String>,
    mode: ModeKind,
    request: &Request,
    root: &File,
    receipt_directory: Option<&Path>,
) -> Result<(i64, String), IndexerError> {
    let initial = root.metadata()?;
    if identity(&initial) != request.root_identity {
        return Err(failure("source_changed"));
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let scope_id = scope.ensure(&tx)?;
    // Admission guarantees no older scanning owner remains alive. Keep all
    // provisional evidence, and fence its publication before starting anew.

    let generation = match generation {
        Some(value) if valid_label(&value) => value,
        Some(_) => return Err(failure("invalid_request")),
        None => tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?,
    };
    let root_text = request
        .root
        .to_str()
        .ok_or_else(|| failure("invalid_request"))?;
    let excludes =
        serde_json::to_string(&request.excluded_paths).map_err(|_| failure("invalid_request"))?;
    let mount = mount_identity(root);
    let root_stamp = stamp(&initial);
    let receipt_directory = receipt_directory.and_then(Path::to_str);
    if let Some(previous) = status(&tx, scope, None)? {
        if previous.root != root_text
            || previous.root_identity != request.root_identity
            || previous.mount != mount
        {
            // Rebinding a root ID cannot confer old membership on its new
            // path or mount. Cache keys are physical, independent of grants.
            tx.execute(
                "UPDATE inventory_scopes SET watcher_cursor=watcher_cursor+1 WHERE id=?1",
                [scope_id],
            )?;
            tx.execute("UPDATE inventory_generations SET coverage='invalidated' WHERE scope=?1 AND mode='backup' AND coverage NOT IN ('invalidated','cancelled')",[scope_id])?;
        }
    }
    if mode == ModeKind::Backup {
        let previous = status(&tx, scope, Some(&generation))?;
        if let Some(old) = previous {
            if old.mode != "backup"
                || old.root != root_text
                || old.root_identity != request.root_identity
                || old.mount != mount
                || old.excludes != excludes
                || old.ignores != request.ignore_rules
                || old.native_receipts.as_deref() != receipt_directory
                || old.coverage != "scanning"
            {
                return Err(failure("generation_exists"));
            }
            // Restarting a stream cannot bridge watcher loss. Preserve the
            // uploadable revisions, record a root gap, and reobserve live data.
            tx.execute("INSERT INTO inventory_gaps(generation,ordinal,reason,coverage) SELECT id,gap_count,'changed','root' FROM inventory_generations WHERE id=?1",[old.id])?;
            tx.execute("UPDATE inventory_generations SET root_stamp=?2,indexed=0,gap_count=gap_count+1 WHERE id=?1",params![old.id,root_stamp])?;
            tx.commit()?;
            return Ok((old.id, generation));
        }
    }
    tx.execute("UPDATE inventory_generations SET coverage='invalidated' WHERE scope=?1 AND coverage='scanning'", [scope_id])?;
    let inserted = tx.execute("INSERT INTO inventory_generations(scope,generation,mode,coverage,root,root_identity,root_stamp,mount,watcher_cursor,created_ms,excludes,ignores,native_receipts)
        SELECT id,?2,?3,'scanning',?4,?5,?6,?7,watcher_cursor,?8,?9,?10,?11 FROM inventory_scopes WHERE id=?1 ON CONFLICT DO NOTHING",
        params![scope_id,generation,mode.name(),root_text,request.root_identity,root_stamp,mount,now_ms(),excludes,request.ignore_rules,receipt_directory])?;
    if inserted == 0 {
        return Err(failure("generation_exists"));
    }
    let id = tx.last_insert_rowid();
    tx.commit()?;
    Ok((id, generation))
}

fn scanning(db: &Connection, id: i64) -> rusqlite::Result<bool> {
    db.query_row("SELECT g.coverage='scanning' AND (g.mode='backup' OR g.watcher_cursor=s.watcher_cursor) FROM inventory_generations g
        JOIN inventory_scopes s ON g.scope=s.id WHERE g.id=?1", [id], |r| r.get(0))
}

fn publish(db: &Connection, id: i64, from: &str, to: &str) -> Result<(), IndexerError> {
    let updated = db.execute("UPDATE inventory_generations SET coverage=?3 WHERE id=?1 AND coverage=?2
        AND (mode='backup' OR watcher_cursor=(SELECT watcher_cursor FROM inventory_scopes WHERE id=inventory_generations.scope))", params![id,from,to])?;
    if updated == 0 {
        return Err(failure("capture_cancelled"));
    }
    Ok(())
}

fn remember(db: &mut Connection, id: i64, entry: &Entry, strict: bool) -> Result<(), IndexerError> {
    let data = serde_json::to_string(entry).map_err(|_| failure("inventory_unavailable"))?;
    let parent = entry.path.rsplit_once('/').map_or("", |(parent, _)| parent);
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if !scanning(&tx, id)? {
        return Err(failure("capture_cancelled"));
    }
    if strict {
        if tx.execute(
            "INSERT INTO inventory_identities VALUES(?1,?2) ON CONFLICT DO NOTHING",
            params![id, entry.id],
        )? == 0
        {
            return Err(failure("duplicate_identity"));
        }
    }
    let inserted = tx.execute("INSERT INTO inventory_entries(generation,path,parent,version,identity,data) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT DO NOTHING",
        params![id,entry.path,parent,entry.version,entry.id,data])?;
    if strict && inserted == 0 {
        return Err(failure("duplicate_path"));
    }
    if inserted != 0 {
        tx.execute(
            "UPDATE inventory_generations SET entry_count=entry_count+1 WHERE id=?1",
            [id],
        )?;
    }
    if !strict {
        let revised = inserted != 0 || tx.execute("UPDATE inventory_entries SET version=?3,identity=?4,data=?5 WHERE generation=?1 AND path=?2 AND version<>?3", params![id,entry.path,entry.version,entry.id,data])? != 0;
        if revised {
            revision(&tx, id, "entry", &data)?;
        }
    }
    tx.commit()?;
    Ok(())
}

fn remember_gap(db: &mut Connection, id: i64, gap: &Gap) -> Result<(), IndexerError> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if !scanning(&tx, id)? {
        return Err(failure("capture_cancelled"));
    }
    tx.execute(
        "INSERT INTO inventory_gaps(generation,ordinal,path,reason,coverage) SELECT id,gap_count,?2,?3,?4 FROM inventory_generations WHERE id=?1",
        params![id, gap.path, gap.reason, gap.scope],
    )?;
    tx.execute(
        "UPDATE inventory_generations SET gap_count=gap_count+1 WHERE id=?1",
        [id],
    )?;
    tx.commit()?;
    Ok(())
}

fn revision(db: &Connection, id: i64, kind: &str, data: &str) -> rusqlite::Result<()> {
    db.execute("INSERT INTO inventory_revisions(generation,sequence,kind,data)
        VALUES(?1,coalesce((SELECT max(sequence)+1 FROM inventory_revisions WHERE generation=?1),1),?2,?3)", params![id,kind,data])?;
    Ok(())
}

// The queue is disk-backed, so arbitrarily broad or deep roots do not need a
// descriptor/stack per ancestor or a memory-resident list of pending paths.
fn strict_scan(
    db: &mut Connection,
    id: i64,
    root: &File,
    request: &Request,
    cache: &Cache,
    cancelled: &AtomicBool,
    receipts: Option<Arc<native_receipts::Receipts>>,
    failure_path: &mut Option<String>,
    emit: &mut impl FnMut(Event) -> Result<(), IndexerError>,
) -> Result<(), IndexerError> {
    let governor = sync_governor(
        request.resource_limits.clone(),
        request.scan_bytes_per_second,
        request.cpu_budget_shares,
    )?;
    let policy = streaming::Policy {
        ignores: Arc::new(BackupIgnoreRules::new(
            request.ignore_rules.as_deref().unwrap_or(""),
        )),
        exclusions: request.excluded_paths.iter().map(|p| key(p)).collect(),
        invalid: Arc::new(regex::Regex::new(r"[\p{Cc}\p{Cf}]").expect("constant unicode classes")),
        receipts,
        cache: None,
    };
    // Preparation has no absence/deletion authority. Its rows are unreadable
    // until an independent, watched seal reopens every recorded descriptor.
    let root_mount = mount_identity(root);
    let root_device = root.metadata()?.dev();
    if root_mount.is_none() {
        return Err(failure("mount_identity_unavailable"));
    }
    db.execute("INSERT INTO inventory_directories(generation,path,stamp) SELECT id,'',root_stamp FROM inventory_generations WHERE id=?1", [id])?;
    let mut last = String::new();
    let mut progress = std::time::Instant::now();
    loop {
        let next = db.query_row("SELECT path,stamp FROM inventory_directories WHERE generation=?1 AND pending=1 ORDER BY path LIMIT 1", [id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()?;
        let Some((dir_path, expected)) = next else {
            break;
        };
        if cancelled.load(Ordering::Relaxed) || !scanning(db, id)? {
            return Err(failure("capture_cancelled"));
        }
        *failure_path = (!dir_path.is_empty()).then(|| dir_path.clone());
        let directory = if dir_path.is_empty() {
            root.try_clone()?
        } else {
            open_path(root, &dir_path).map_err(failure)?
        };
        if stamp(&directory.metadata()?) != expected || mount_identity(&directory) != root_mount {
            return Err(failure("source_changed"));
        }
        let mut children =
            rustix::fs::Dir::read_from(&directory).map_err(|e| failure(io_reason(e)))?;
        for child in &mut children {
            if cancelled.load(Ordering::Relaxed) {
                return Err(failure("capture_cancelled"));
            }
            governor.checkpoint()?;
            let child = child.map_err(|e| failure(io_reason(e)))?;
            let name = child.file_name().to_bytes();
            if name == b"." || name == b".." {
                continue;
            }
            let name = std::str::from_utf8(name).map_err(|_| failure("invalid_path"))?;
            last.clear();
            if !dir_path.is_empty() {
                last.push_str(&dir_path);
                last.push('/');
            }
            last.push_str(name);
            if !valid_path(&last) || policy.invalid.is_match(&last) {
                return Err(failure("invalid_path"));
            }
            *failure_path = Some(last.clone());
            let canonical = key(&last);
            if policy.exclusions.iter().any(|p| {
                &canonical == p
                    || canonical
                        .strip_prefix(p)
                        .is_some_and(|v| v.starts_with('/'))
            }) {
                continue;
            }
            let stat = statat(&directory, name, AtFlags::SYMLINK_NOFOLLOW)
                .map_err(|e| failure(io_reason(e)))?;
            if stat.st_dev as u64 != root_device {
                return Err(failure("mount_changed"));
            }
            let is_dir = FileType::from_raw_mode(stat.st_mode) == FileType::Directory;
            if policy.ignores.ignores_entry(&last, is_dir) {
                db.execute(
                    "UPDATE inventory_generations SET ignored_count=ignored_count+1 WHERE id=?1",
                    [id],
                )?;
                emit(Event::Ignored)?;
                continue;
            }
            if db.execute(
                "INSERT INTO inventory_names VALUES(?1,?2) ON CONFLICT DO NOTHING",
                params![id, canonical],
            )? == 0
            {
                return Err(failure("collision"));
            }
            let entry = observe_projected(
                root,
                &last,
                &governor,
                cancelled,
                Some(cache),
                root_mount.as_deref(),
                policy.receipts.as_deref(),
            )
            .map_err(failure)?;
            let Some(entry) = entry else {
                let version = metadata_version(root, &last).map_err(failure)?;
                db.execute(
                    "INSERT INTO inventory_omissions(generation,path,version) VALUES(?1,?2,?3)",
                    params![id, last, version],
                )?;
                db.execute(
                    "UPDATE inventory_generations SET ignored_count=ignored_count+1 WHERE id=?1",
                    [id],
                )?;
                emit(Event::Ignored)?;
                continue;
            };
            if entry.id != format!("{}:{}", stat.st_dev as u64, stat.st_ino as u64) {
                return Err(failure("source_changed"));
            }
            remember(db, id, &entry, true)?;
            if is_dir {
                db.execute(
                    "INSERT INTO inventory_directories(generation,path,stamp) VALUES(?1,?2,?3)",
                    params![id, entry.path, entry.version],
                )?;
            }
            emit(Event::Entry { entry })?;
            if request.resource_feedback && progress.elapsed() >= Duration::from_millis(250) {
                emit(Event::Resources {
                    usage: governor.snapshot(),
                })?;
                progress = std::time::Instant::now();
            }
        }
        *failure_path = (!dir_path.is_empty()).then(|| dir_path.clone());
        if stamp(&directory.metadata()?) != expected {
            return Err(failure("source_changed"));
        }
        db.execute(
            "UPDATE inventory_directories SET pending=0 WHERE generation=?1 AND path=?2",
            params![id, dir_path],
        )?;
    }
    *failure_path = None;
    let current = open_root(&request.root)?;
    if identity(&current.metadata()?) != request.root_identity
        || mount_identity(&current) != root_mount
    {
        return Err(failure("source_changed"));
    }
    governor.check_memory_now()?;
    if request.resource_feedback {
        emit(Event::Resources {
            usage: governor.finish(),
        })?;
    }
    Ok(())
}

fn seal(
    db: &mut Connection,
    current: &Status,
    root_path: &Path,
    root_identity: &str,
    governor: &ResourceGovernor,
    cancelled: &AtomicBool,
    receipts: Option<&native_receipts::Receipts>,
    failure_path: &mut Option<(String, &'static str)>,
    mut on_entry_verified: impl FnMut(&str),
) -> Result<(), IndexerError> {
    if current.mode != "strict"
        || !matches!(current.coverage.as_str(), "prepared" | "sealed")
        || current.gap_count != 0
        || root_path.to_str() != Some(current.root.as_str())
        || root_identity != current.root_identity
    {
        return Err(failure("generation_unavailable"));
    }
    let root = open_root(root_path)?;
    require_strict_volume(&root)?;
    let metadata = root.metadata()?;
    let mount = mount_identity(&root);
    if stamp(&metadata) != current.root_stamp || mount.is_none() || mount != current.mount {
        return Err(failure("source_changed"));
    }
    if current.coverage == "sealed" {
        return Ok(());
    }
    // A disconnected scan watcher is never treated as proof of absence. A new
    // subscription and complete descriptor-relative revalidation establish a
    // fresh sealing point. Short read statements avoid a long WAL snapshot.
    let changes = streaming::watch_strict(root_path)?;
    let exclusions: Vec<String> =
        serde_json::from_str(&current.excludes).map_err(|_| failure("inventory_unavailable"))?;
    let policy = streaming::Policy {
        ignores: Arc::new(BackupIgnoreRules::new(
            current.ignores.as_deref().unwrap_or(""),
        )),
        exclusions: exclusions.iter().map(|p| key(p)).collect(),
        invalid: Arc::new(regex::Regex::new("a^").unwrap()),
        receipts: None,
        cache: None,
    };
    let mut after = None::<String>;
    loop {
        let (sql, first) = if after.is_some() {
            ("SELECT path,stamp FROM inventory_directories WHERE generation=?1 AND path>?2 ORDER BY path LIMIT 128", false)
        } else {
            ("SELECT path,stamp FROM inventory_directories WHERE generation=?1 AND path>=?2 ORDER BY path LIMIT 128", true)
        };
        let mut stmt = db.prepare_cached(sql)?;
        let rows = stmt
            .query_map(params![current.id, after.as_deref().unwrap_or("")], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        if rows.is_empty() {
            break;
        }
        for (path, expected) in rows {
            *failure_path = (!path.is_empty()).then(|| (path.clone(), "subtree"));
            if cancelled.load(Ordering::Relaxed) {
                return Err(failure("capture_cancelled"));
            }
            governor.checkpoint()?;
            let file = if path.is_empty() && first {
                root.try_clone()?
            } else {
                open_path(&root, &path).map_err(failure)?
            };
            changes
                .track_directory(&root_path.join(&path))
                .map_err(failure)?;
            if stamp(&file.metadata()?) != expected || mount_identity(&file) != mount {
                return Err(failure("source_changed"));
            }
            after = Some(path);
        }
        check_seal_events(
            db,
            current,
            &changes,
            &root,
            &policy,
            governor,
            cancelled,
            failure_path,
        )?;
    }
    let mut after = String::new();
    loop {
        let mut stmt = db.prepare_cached("SELECT path,version FROM inventory_omissions WHERE generation=?1 AND path>?2 ORDER BY path LIMIT 128")?;
        let rows = stmt
            .query_map(params![current.id, after], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        if rows.is_empty() {
            break;
        }
        for (path, expected) in rows {
            *failure_path = (!path.is_empty()).then(|| (path.clone(), "subtree"));
            if cancelled.load(Ordering::Relaxed) {
                return Err(failure("capture_cancelled"));
            }
            governor.checkpoint()?;
            let receipts = receipts.ok_or_else(|| failure("source_changed"))?;
            changes
                .track_directory(&root_path.join(&path))
                .map_err(failure)?;
            if !matches!(
                receipts
                    .inspect(&root, &path, governor, cancelled)
                    .map_err(failure)?,
                native_receipts::Projection::Skip
            ) || metadata_version(&root, &path).map_err(failure)? != expected
            {
                return Err(failure("source_changed"));
            }
            after = path;
        }
        check_seal_events(
            db,
            current,
            &changes,
            &root,
            &policy,
            governor,
            cancelled,
            failure_path,
        )?;
    }
    let mut after = String::new();
    loop {
        let mut stmt = db.prepare_cached("SELECT path,version,json_extract(data,'$.symbolicLink.targetBase64'),json_extract(data,'$.fingerprint.sha256')
            FROM inventory_entries WHERE generation=?1 AND path>?2 ORDER BY path LIMIT 128")?;
        let rows = stmt
            .query_map(params![current.id, after], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        if rows.is_empty() {
            break;
        }
        for (path, expected, link, digest) in rows {
            *failure_path = Some((path.clone(), "entry"));
            if cancelled.load(Ordering::Relaxed) {
                return Err(failure("capture_cancelled"));
            }
            governor.checkpoint()?;
            let version = if let Some(link) = link {
                let entry = observe_projected(
                    &root,
                    &path,
                    governor,
                    cancelled,
                    None,
                    mount.as_deref(),
                    receipts,
                )
                .map_err(failure)?
                .ok_or_else(|| failure("source_changed"))?;
                if entry
                    .symbolic_link
                    .as_ref()
                    .map(|link| link.target_base64.as_str())
                    != Some(link.as_str())
                    || entry
                        .fingerprint
                        .as_ref()
                        .map(|fingerprint| fingerprint.sha256.as_str())
                        != digest.as_deref()
                {
                    return Err(failure("source_changed"));
                }
                entry.version
            } else {
                if let Some(receipts) = receipts {
                    if !matches!(
                        receipts
                            .inspect(&root, &path, governor, cancelled)
                            .map_err(failure)?,
                        native_receipts::Projection::Raw
                    ) {
                        return Err(failure("source_changed"));
                    }
                }
                let file = open_path(&root, &path).map_err(failure)?;
                if mount_identity(&file) != mount {
                    return Err(failure("mount_changed"));
                }
                stamp(&file.metadata()?)
            };
            if version != expected {
                return Err(failure("source_changed"));
            }
            on_entry_verified(&path);
            after = path;
        }
        check_seal_events(
            db,
            current,
            &changes,
            &root,
            &policy,
            governor,
            cancelled,
            failure_path,
        )?;
    }
    *failure_path = None;
    if stamp(&open_root(root_path)?.metadata()?) != current.root_stamp {
        return Err(failure("source_changed"));
    }
    check_seal_events(
        db,
        current,
        &changes,
        &root,
        &policy,
        governor,
        cancelled,
        failure_path,
    )?;
    std::thread::sleep(Duration::from_millis(100));
    check_seal_events(
        db,
        current,
        &changes,
        &root,
        &policy,
        governor,
        cancelled,
        failure_path,
    )?;
    if cancelled.load(Ordering::Relaxed) {
        return Err(failure("capture_cancelled"));
    }
    publish(db, current.id, "prepared", "sealed")
}

fn check_seal_events(
    db: &Connection,
    current: &Status,
    changes: &streaming::Changes,
    root: &File,
    policy: &streaming::Policy,
    governor: &ResourceGovernor,
    cancelled: &AtomicBool,
    failure_path: &mut Option<(String, &'static str)>,
) -> Result<(), IndexerError> {
    *failure_path = None;
    let can_check_hints = has_precise_stamps(root);
    let mut expected = db.prepare_cached(
        "SELECT version FROM inventory_entries WHERE generation=?1 AND path=?2
         UNION ALL SELECT version FROM inventory_omissions WHERE generation=?1 AND path=?2 LIMIT 1",
    )?;
    changes
        .check_quiet(root, policy, |path| {
            if !can_check_hints
                || cancelled.load(Ordering::Relaxed)
                || governor.checkpoint().is_err()
            {
                return false;
            }
            if path.is_empty() {
                return root
                    .metadata()
                    .is_ok_and(|metadata| stamp(&metadata) == current.root_stamp)
                    && mount_identity(root) == current.mount;
            }
            // FSEvents can deliver a pre-subscription create/modify notification
            // after we begin checking the generation. It is safe to ignore only
            // when the already-recorded item still has the exact no-follow stamp.
            expected
                .query_row(params![current.id, path], |row| row.get::<_, String>(0))
                .is_ok_and(|expected| {
                    metadata_version(root, path).is_ok_and(|live| live == expected)
                })
        })
        .map_err(|path| {
            *failure_path = path.map(|path| (path, "subtree"));
            failure(if cancelled.load(Ordering::Relaxed) {
                "capture_cancelled"
            } else {
                "watcher_gap"
            })
        })
}

pub(super) fn scan(
    database_path: &Path,
    mut request: Request,
    scope: Scope,
    generation: Option<String>,
    mode: ModeKind,
    control: Option<Arc<WatchControl>>,
    receipt_directory: Option<PathBuf>,
    cancelled: Arc<AtomicBool>,
    mut emit: impl FnMut(Value) -> Result<(), IndexerError>,
) -> Result<(), IndexerError> {
    scope.validate()?;
    if mode == ModeKind::Strict && !streaming::supports_strict() {
        return Err(failure("strict_watcher_unavailable"));
    }
    if request.version != VERSION
        || request.excluded_paths.iter().any(|p| !valid_path(p))
        || request
            .ignore_rules
            .as_ref()
            .is_some_and(|s| s.contains('\0'))
        || ![1, 3].contains(&request.cpu_budget_shares)
        || request
            .scan_bytes_per_second
            .is_some_and(|rate| !rate.is_finite() || rate < 1.0)
    {
        return Err(failure("invalid_request"));
    }
    let mut db = IndexDatabase::open(database_path)?.connection;
    let _admission = admit(database_path)?;
    let root = open_root(&request.root)?;
    if mode == ModeKind::Strict {
        require_strict_volume(&root)?;
    }
    // No sync configuration can enumerate its own private database or another
    // scope through the SQLite/WAL files, even when the grant is above it.
    if let Ok(database) = database_path.canonicalize() {
        if let Ok(relative) = database.strip_prefix(&request.root) {
            let base = relative
                .to_str()
                .ok_or_else(|| failure("invalid_request"))?;
            for suffix in ["", "-wal", "-shm", "-journal", ".sync-admission"] {
                request.excluded_paths.push(format!("{base}{suffix}"));
            }
        }
    }
    if let Some(receipts) = receipt_directory.as_deref() {
        if let Ok(relative) = receipts.strip_prefix(&request.root) {
            let relative = relative
                .to_str()
                .filter(|relative| valid_path(relative))
                .ok_or_else(|| failure("invalid_request"))?;
            request.excluded_paths.push(relative.to_owned());
        }
    }
    request.excluded_paths.sort_unstable();
    request.excluded_paths.dedup();
    request.scan_bytes_per_second = Some(sync_scan_rate(request.scan_bytes_per_second));
    let receipts = open_receipts(receipt_directory.as_deref())?;
    let (id, generation) = begin(
        &mut db,
        &scope,
        generation,
        mode,
        &request,
        &root,
        receipt_directory.as_deref(),
    )?;
    let cache = Arc::new(Cache::new(database_path)?);
    let finite_backup = mode == ModeKind::Backup && !request.streaming;
    let done = AtomicBool::new(false);
    let waiter = IndexDatabase::open_reader(database_path)?.connection;
    let result = std::thread::scope(|threads| {
        let check = cancelled.clone();
        let finished = &done;
        let observer = threads.spawn(move || {
            while !finished.load(Ordering::Relaxed) && !check.load(Ordering::Relaxed) {
                std::thread::park_timeout(Duration::from_millis(100));
                if matches!(scanning(&waiter, id), Ok(false)) {
                    check.store(true, Ordering::Relaxed);
                }
            }
        });
        let mut relay = |event: Event| -> Result<(), IndexerError> {
            match &event {
                Event::Entry { entry } if mode == ModeKind::Backup => {
                    remember(&mut db, id, entry, false)?
                }
                Event::Skipped { gap } => remember_gap(&mut db, id, gap)?,
                Event::Ignored => {
                    db.execute("UPDATE inventory_generations SET ignored_count=ignored_count+1 WHERE id=?1",[id])?;
                }
                Event::Indexed => {
                    db.execute(
                        "UPDATE inventory_generations SET indexed=1 WHERE id=?1",
                        [id],
                    )?;
                }
                Event::Complete => return Ok(()),
                _ => (),
            }
            let hello = matches!(event, Event::Hello { .. });
            let mut wire =
                serde_json::to_value(event).map_err(|_| failure("inventory_unavailable"))?;
            if hello {
                wire["generation"] = json!(generation);
            }
            emit(wire)
        };
        let result = match mode {
            ModeKind::Strict => {
                // This private pipe is for the host's live validation; the
                // page API cannot expose these rows before publication.
                let result = relay(Event::Hello {
                    version: VERSION,
                    streaming: None,
                });
                drop(relay);
                let mut failure_path = None;
                let outcome = result.and_then(|_| {
                    strict_scan(
                        &mut db,
                        id,
                        &root,
                        &request,
                        &cache,
                        &cancelled,
                        receipts.clone(),
                        &mut failure_path,
                        &mut |event| {
                            emit(
                                serde_json::to_value(event)
                                    .map_err(|_| failure("inventory_unavailable"))?,
                            )
                        },
                    )
                });
                if let Err(error) = &outcome {
                    let reason = match error.code {
                        "invalid_path" | "invalid-path" => Some("invalid-path"),
                        "duplicate_identity" => Some("duplicate-identity"),
                        "duplicate_path" | "collision" => Some("path-collision"),
                        "source_changed" | "mount_changed" | "watcher_gap" | "changed" => {
                            Some("changed")
                        }
                        "source_unavailable" | "unreadable" => Some("unreadable"),
                        reason @ ("symlink" | "special" | "fifo" | "socket" | "device") => {
                            Some(reason)
                        }
                        _ => None,
                    };
                    if let Some(reason) = reason {
                        let path = if reason == "invalid-path" {
                            None
                        } else {
                            failure_path
                        };
                        let scope = if path.is_none() && matches!(reason, "changed" | "unreadable")
                        {
                            "root"
                        } else {
                            "subtree"
                        };
                        if path.is_some() || scope == "root" || reason == "invalid-path" {
                            let skipped = Gap {
                                path,
                                reason,
                                scope,
                            };
                            let _ = remember_gap(&mut db, id, &skipped);
                            if let Ok(event) = serde_json::to_value(Event::Skipped { gap: skipped })
                            {
                                let _ = emit(event);
                            }
                        }
                    }
                }
                outcome
            }
            ModeKind::Backup => capture_inner(
                request,
                control,
                Some(cache),
                Some(cancelled.clone()),
                receipts,
                relay,
            ),
        };
        done.store(true, Ordering::Relaxed);
        observer.thread().unpark();
        result
    });
    if let Err(error) = result {
        if mode == ModeKind::Strict {
            let _ = db.execute("UPDATE inventory_generations SET coverage='invalidated' WHERE id=?1 AND coverage='scanning'",[id]);
        }
        return Err(error);
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(failure("capture_cancelled"));
    }
    if finite_backup {
        // A provisional directory whose namespace changed during traversal
        // remains positive evidence only. Record the affected subtree gap.
        let mut after = String::new();
        loop {
            let mut stmt=db.prepare_cached("SELECT path,version FROM inventory_entries WHERE generation=?1 AND path>?2 AND json_extract(data,'$.kind')='folder' ORDER BY path LIMIT 128")?;
            let rows = stmt
                .query_map(params![id, after], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            drop(stmt);
            if rows.is_empty() {
                break;
            }
            for (path, version) in rows {
                if cancelled.load(Ordering::Relaxed) {
                    return Err(failure("capture_cancelled"));
                }
                if metadata_version(&root, &path).ok().as_deref() != Some(version.as_str()) {
                    let gap = Gap {
                        path: Some(path.clone()),
                        reason: "changed",
                        scope: "subtree",
                    };
                    remember_gap(&mut db, id, &gap)?;
                    emit(
                        serde_json::to_value(Event::Skipped { gap })
                            .map_err(|_| failure("inventory_unavailable"))?,
                    )?;
                }
                after = path;
            }
        }
    }
    let coverage = if mode == ModeKind::Strict {
        "prepared"
    } else {
        "provisional"
    };
    finalize_ordinal_page(&mut db, id, coverage, None)?;
    let current =
        status(&db, &scope, Some(&generation))?.ok_or_else(|| failure("generation_unavailable"))?;
    emit(
        json!({"event":"complete","generation":generation,"coverage":current.coverage,"entryCount":current.entry_count,
        "gapCount":current.gap_count,"ignoredCount":current.ignored_count,"rootVersion":current.root_stamp,"revision":current.revision,"watcherCursor":current.watcher_cursor}),
    )
}

fn finalize_ordinal_page(
    db: &mut Connection,
    id: i64,
    coverage: &str,
    expected_count: Option<u64>,
) -> Result<(), IndexerError> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if let Some(expected) = expected_count {
        let count = tx.query_row(
            "SELECT entry_count FROM inventory_generations WHERE id=?1",
            [id],
            |r| r.get::<_, u64>(0),
        )?;
        if count != expected {
            return Err(failure("generation_unavailable"));
        }
    }
    tx.execute("DELETE FROM inventory_ordinals WHERE generation=?1", [id])?;
    tx.execute("INSERT INTO inventory_ordinals(generation,ordinal,path) SELECT generation,row_number() OVER (ORDER BY path)-1,path FROM inventory_entries WHERE generation=?1",[id])?;
    publish(&tx, id, "scanning", coverage)?;
    tx.commit()?;
    Ok(())
}

fn read_snapshot(db: &Connection, current: &Status) -> Result<(), IndexerError> {
    let unchanged: bool = db.query_row(
        "SELECT g.coverage=?2 AND (g.mode='backup' OR g.watcher_cursor=s.watcher_cursor)
        FROM inventory_generations g JOIN inventory_scopes s ON g.scope=s.id WHERE g.id=?1",
        params![current.id, current.coverage],
        |r| r.get(0),
    )?;
    if !unchanged {
        return Err(failure("generation_unavailable"));
    }
    Ok(())
}
fn requested_limit(limit: Option<usize>) -> Result<usize, IndexerError> {
    match limit.unwrap_or(128) {
        0 => Err(failure("invalid_request")),
        n => Ok(n.min(PAGE_LIMIT)),
    }
}
const PAGE_BYTES: usize = 500 * 1024;

fn page(
    db: &mut Connection,
    current: Status,
    after: Option<&str>,
    parent: Option<&str>,
    offset: Option<usize>,
    limit: Option<usize>,
    output: &mut impl Write,
) -> Result<(), IndexerError> {
    if !matches!(current.coverage.as_str(), "sealed" | "provisional") {
        return Err(failure("generation_unavailable"));
    }
    if after.is_some() && offset.is_some()
        || after.is_some_and(|p| !valid_path(p))
        || parent.is_some_and(|p| !p.is_empty() && !valid_path(p))
    {
        return Err(failure("invalid_request"));
    }
    // A sealed generation is a historical snapshot, but it is never usable
    // against a replacement root or a different mount of that grant.
    if current.mode != "photo" {
        let root = open_root(Path::new(&current.root))?;
        if current.mode == "strict" {
            require_strict_volume(&root)?;
        }
        if identity(&root.metadata()?) != current.root_identity
            || mount_identity(&root) != current.mount
        {
            return Err(failure("source_changed"));
        }
    }
    let limit = requested_limit(limit)?;
    let offset = offset.unwrap_or(0);
    let tx = db.transaction()?;
    read_snapshot(&tx, &current)?;
    let sql = if parent.is_none() && after.is_none() {
        "SELECT e.path,e.data FROM inventory_ordinals o JOIN inventory_entries e ON e.generation=o.generation AND e.path=o.path WHERE o.generation=?1 AND ?2='' AND ?3='' AND o.ordinal>=?5 ORDER BY o.ordinal LIMIT ?4"
    } else if parent.is_some() {
        "SELECT path,data FROM inventory_entries WHERE generation=?1 AND parent=?2 AND path>?3 ORDER BY path LIMIT ?4 OFFSET ?5"
    } else {
        "SELECT path,data FROM inventory_entries WHERE generation=?1 AND ?2='' AND path>?3 ORDER BY path LIMIT ?4 OFFSET ?5"
    };
    let mut stmt = tx.prepare_cached(sql)?;
    let mut rows = stmt.query(params![
        current.id,
        parent.unwrap_or(""),
        after.unwrap_or(""),
        limit + 1,
        offset
    ])?;
    let mut entries = Vec::<Value>::new();
    let mut last = None;
    let mut more = false;
    let mut size = 0;
    while let Some(row) = rows.next()? {
        let data: String = row.get(1)?;
        if entries.len() >= limit || (!entries.is_empty() && size + data.len() > PAGE_BYTES) {
            more = true;
            break;
        }
        size += data.len();
        last = Some(row.get::<_, String>(0)?);
        entries.push(serde_json::from_str(&data).map_err(|_| failure("inventory_unavailable"))?);
    }
    let total = if let Some(parent) = parent {
        tx.query_row(
            "SELECT count(*) FROM inventory_entries WHERE generation=?1 AND parent=?2",
            params![current.id, parent],
            |r| r.get::<_, u64>(0),
        )?
    } else {
        current.entry_count
    };
    write_value(
        output,
        &json!({"generation":current.generation,"entries":entries,"nextAfter":if more {last} else {None},
        "nextOffset":(more && after.is_none()).then_some(offset+entries.len()),"coverage":current.coverage,"totalEntries":total,"rootVersion":current.root_stamp,
        "status":current}),
    )
}

fn gaps(
    db: &mut Connection,
    current: Status,
    after: Option<i64>,
    offset: Option<usize>,
    limit: Option<usize>,
    output: &mut impl Write,
) -> Result<(), IndexerError> {
    if after.is_some_and(|value| value < 0) || (after.is_some() && offset.is_some()) {
        return Err(failure("invalid_request"));
    }
    let limit = requested_limit(limit)?;
    let tx = db.transaction()?;
    let sql = if after.is_some() {
        "SELECT sequence,path,reason,coverage FROM inventory_gaps WHERE generation=?1 AND sequence>?2 ORDER BY sequence LIMIT ?3"
    } else {
        "SELECT sequence,path,reason,coverage FROM inventory_gaps WHERE generation=?1 AND ordinal>=?2 ORDER BY ordinal LIMIT ?3"
    };
    let mut stmt = tx.prepare_cached(sql)?;
    let offset = offset.unwrap_or(0);
    let anchor = after.unwrap_or(i64::try_from(offset).map_err(|_| failure("invalid_request"))?);
    let mut rows = stmt.query(params![current.id, anchor, limit + 1])?;
    let mut values = Vec::<Value>::new();
    let mut size = 0;
    let mut last = None;
    let mut more = false;
    while let Some(row) = rows.next()? {
        let sequence: i64 = row.get(0)?;
        let path: Option<String> = row.get(1)?;
        let value = json!({"sequence":sequence,"path":path,"reason":row.get::<_,String>(2)?,"scope":row.get::<_,String>(3)?});
        size += value.to_string().len();
        if values.len() >= limit || (!values.is_empty() && size > PAGE_BYTES) {
            more = true;
            break;
        }
        last = Some(sequence);
        values.push(value);
    }
    write_value(
        output,
        &json!({"generation":current.generation,"gaps":values,"nextAfterSequence":if more {last} else {None},"nextOffset":(more && after.is_none()).then_some(offset+values.len()),"gapCount":current.gap_count}),
    )
}

fn change_page(
    db: &mut Connection,
    current: Status,
    after: i64,
    limit: Option<usize>,
    output: &mut impl Write,
) -> Result<(), IndexerError> {
    if current.mode != "backup" || after < 0 || after as u64 > current.revision {
        return Err(failure("invalid_request"));
    }
    let limit = requested_limit(limit)?;
    let tx = db.transaction()?;
    let mut stmt=tx.prepare_cached("SELECT sequence,data FROM inventory_revisions WHERE generation=?1 AND sequence>?2 AND sequence<=?3 ORDER BY sequence LIMIT ?4")?;
    let mut rows = stmt.query(params![current.id, after, current.revision, limit])?;
    let mut values = Vec::<Value>::new();
    let mut size = 0;
    let mut last = after;
    while let Some(row) = rows.next()? {
        let sequence: i64 = row.get(0)?;
        let data: String = row.get(1)?;
        size += data.len() + 100;
        if !values.is_empty() && size > PAGE_BYTES {
            break;
        }
        let entry: Value =
            serde_json::from_str(&data).map_err(|_| failure("inventory_unavailable"))?;
        values.push(json!({"sequence":sequence,"entry":entry,"revision":entry["version"]}));
        last = sequence;
    }
    write_value(
        output,
        &json!({"id":current.generation,"generation":current.generation,"state":current.state,"revision":current.revision,
        "changes":values,"nextSequence":last,"hasMore":(last as u64)<current.revision,"totalEntries":current.entry_count,"totalSkipped":current.gap_count}),
    )
}

fn invalidate_paths(
    db: &mut Connection,
    paths: &[PathBuf],
    lost_events: bool,
) -> Result<usize, IndexerError> {
    if paths.len() > 256
        || paths.iter().any(|p| {
            !p.is_absolute()
                || p.components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
                || p.to_str().is_none()
        })
    {
        return Err(failure("invalid_request"));
    }
    if lost_events {
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let invalidated = tx.execute(
            "UPDATE inventory_scopes SET watcher_cursor=watcher_cursor+1 WHERE EXISTS (
                SELECT 1 FROM inventory_generations g WHERE g.scope=inventory_scopes.id AND g.mode<>'photo')",
            [],
        )?;
        // A watch gap may include an unmount/remount. Retain old evidence,
        // but do not reuse a fingerprint from the disconnected mount epoch.
        tx.execute(
            "UPDATE metadata SET value=value+1 WHERE key='inventory_cache_epoch'",
            [],
        )?;
        tx.commit()?;
        return Ok(invalidated);
    }
    if paths.is_empty() {
        return Ok(0);
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut matched = std::collections::HashSet::new();
    {
        let mut statement=tx.prepare("SELECT s.id,g.root,g.excludes FROM inventory_scopes s JOIN inventory_generations g
            ON g.id=(SELECT id FROM inventory_generations WHERE scope=s.id AND mode<>'photo' ORDER BY id DESC LIMIT 1)")?;
        let rows = statement.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            let (scope, root, excludes) = row?;
            let excludes: Vec<String> =
                serde_json::from_str(&excludes).map_err(|_| failure("inventory_unavailable"))?;
            let excludes: Vec<String> = excludes.iter().map(|p| key(p)).collect();
            let root = key(&root);
            let root = Path::new(&root);
            if paths.iter().any(|p| {
                let path = key(p.to_str().expect("validated UTF-8"));
                let path = Path::new(&path);
                if root.starts_with(path) {
                    return true;
                }
                let Ok(relative) = path.strip_prefix(root) else {
                    return false;
                };
                !excludes
                    .iter()
                    .any(|excluded| relative.starts_with(excluded))
            }) {
                matched.insert(scope);
            }
        }
    }
    for scope in &matched {
        tx.execute(
            "UPDATE inventory_scopes SET watcher_cursor=watcher_cursor+1 WHERE id=?1",
            [scope],
        )?;
    }
    tx.commit()?;
    Ok(matched.len())
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod seal_regression_tests {
    use super::*;

    #[test]
    fn seal_refuses_an_already_checked_file_changed_while_verifying_later_rows() {
        #[cfg(target_os = "macos")]
        let directory = tempfile::tempdir().unwrap();
        #[cfg(target_os = "linux")]
        let directory = tempfile::tempdir_in("/dev/shm").unwrap();
        let root_path = directory.path().join("source");
        std::fs::create_dir(&root_path).unwrap();
        let root_path = root_path.canonicalize().unwrap();
        let first = root_path.join("a-first");
        std::fs::write(&first, b"first").unwrap();
        std::fs::write(root_path.join("z-last"), b"last").unwrap();
        let database = directory.path().join("index.sqlite3");
        let root_identity = identity(&std::fs::metadata(&root_path).unwrap());
        let scope = || Scope {
            origin: "https://fixture.invalid".into(),
            account_id: "fixture".into(),
            device_id: "fixture".into(),
            root_id: "fixture".into(),
        };
        let cancelled = Arc::new(AtomicBool::new(false));
        let request = Request {
            version: VERSION,
            streaming: false,
            root: root_path.clone(),
            root_identity: root_identity.clone(),
            excluded_paths: vec![],
            ignore_rules: None,
            resource_limits: IndexResourceLimits::default(),
            resource_feedback: false,
            cpu_budget_shares: 1,
            scan_bytes_per_second: None,
        };
        scan(
            &database,
            request,
            scope(),
            Some("generation".into()),
            ModeKind::Strict,
            None,
            None,
            cancelled.clone(),
            |_| Ok(()),
        )
        .unwrap();
        let mut db = IndexDatabase::open(&database).unwrap().connection;
        let prepared = status(&db, &scope(), Some("generation")).unwrap().unwrap();
        assert_eq!(prepared.coverage, "prepared");
        let governor = sync_governor(IndexResourceLimits::default(), None, 1).unwrap();
        let mut changed = false;
        let outcome = seal(
            &mut db,
            &prepared,
            &root_path,
            &root_identity,
            &governor,
            &cancelled,
            None,
            &mut None,
            |path| {
                if path == "z-last" {
                    // The first row already passed its descriptor check. Its
                    // in-place edit leaves the parent namespace stamp intact.
                    std::fs::write(&first, b"changed after verification").unwrap();
                    changed = true;
                }
            },
        );
        assert!(changed);
        assert!(outcome.is_err());
        assert_eq!(
            status(&db, &scope(), Some("generation"))
                .unwrap()
                .unwrap()
                .coverage,
            "prepared"
        );
    }
}

#[cfg(test)]
mod stamp_policy_tests {
    use super::*;

    #[cfg(target_vendor = "apple")]
    #[test]
    fn only_local_apfs_can_reuse_stat_evidence() {
        let local = |name: &[u8]| {
            let name = name
                .iter()
                .map(|&byte| byte as libc::c_char)
                .collect::<Vec<_>>();
            precise_apple_fs(&name, true)
        };
        assert!(local(b"apfs\0"));
        assert!(!local(b"apfs_fake\0"));
        assert!(!local(b"hfs\0"));
        assert!(!local(b"exfat\0"));
        assert!(!local(b"smbfs\0"));
        assert!(!local(b""));
        assert!(!precise_apple_fs(&[97, 112, 102, 115, 0], false));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn coarse_ambiguous_or_remote_mounts_cannot_reuse_stat_evidence() {
        assert!(precise_linux_fs(0x0102_1994)); // tmpfs
        assert!(!precise_linux_fs(0xef53)); // shared ext2/3/4 magic
        assert!(!precise_linux_fs(0x6969)); // NFS
        assert!(!precise_linux_fs(0x794c_7630)); // overlay
        assert!(!precise_linux_fs(0));
    }
}

#[cfg(test)]
mod resource_defaults_tests {
    use super::*;

    #[test]
    fn omitted_limits_use_sync_defaults_and_explicit_limits_are_retained() {
        let omitted: Command =
            serde_json::from_value(json!({"version": 1, "operation": "scan"})).unwrap();
        let partial: Command = serde_json::from_value(json!({
            "version": 1, "operation": "scan", "resourceLimits": {"maxThreads": 2}
        }))
        .unwrap();
        assert_eq!(omitted.resource_limits.max_cpu_percent, 15);
        assert_eq!(partial.resource_limits.max_cpu_percent, 15);
        assert_eq!(partial.resource_limits.max_threads, 2);
        assert_eq!(sync_scan_rate(omitted.scan_bytes_per_second), 625_000.0);

        let explicit: Command = serde_json::from_value(json!({
            "version": 1, "operation": "scan", "scanBytesPerSecond": 50_000_000.0,
            "resourceLimits": {"maxCpuPercent": 40}
        }))
        .unwrap();
        assert_eq!(sync_scan_rate(explicit.scan_bytes_per_second), 50_000_000.0);
        let governor =
            sync_governor(explicit.resource_limits, explicit.scan_bytes_per_second, 1).unwrap();
        assert_eq!(governor.effective().max_cpu_percent, 40);
        assert!(sync_governor(default_sync_limits(), Some(f64::NAN), 1).is_err());
        assert!(sync_governor(default_sync_limits(), Some(-1.0), 1).is_err());
    }
}
