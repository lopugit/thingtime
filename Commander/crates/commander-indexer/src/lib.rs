//! Persistent, portable filesystem metadata indexing for Thingtime desktop apps.
//!
//! The library keeps the scanning and storage boundary independent from any UI
//! host. [`IndexDatabase`] is used directly by the standalone CLI and by the
//! JSON-lines service consumed by Commander.

#![forbid(unsafe_code)]

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use ignore::{WalkBuilder, WalkState};
use regex::RegexSet;
use rusqlite::{params, Connection, ErrorCode, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fmt::{self, Display};
use std::fs;
#[cfg(target_os = "macos")]
use std::os::macos::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const SCHEMA_VERSION: i64 = 2;
const DEFAULT_MAX_ENTRIES: usize = 2_000_000;
const HARD_MAX_ENTRIES: usize = 10_000_000;
const MAX_SOURCES: usize = 128;
const MAX_IGNORE_RULES: usize = 512;
const MAX_QUERY_RESULTS: usize = 1_000;
const MAX_DIAGNOSTICS: usize = 20;
const DATABASE_OPEN_RETRY_ATTEMPTS: usize = 100;
const DATABASE_OPEN_RETRY_DELAY: Duration = Duration::from_millis(25);
const DATABASE_JOURNAL_SIZE_LIMIT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug)]
pub struct IndexerError {
    pub code: &'static str,
    pub message: String,
}

impl IndexerError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl Display for IndexerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for IndexerError {}

impl From<rusqlite::Error> for IndexerError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("database_error", error.to_string())
    }
}

impl From<std::io::Error> for IndexerError {
    fn from(error: std::io::Error) -> Self {
        Self::new("filesystem_error", error.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IndexKind {
    Application,
    File,
    Directory,
}

impl IndexKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Application => "application",
            Self::File => "file",
            Self::Directory => "directory",
        }
    }

    fn from_database(value: &str) -> Result<Self, IndexerError> {
        match value {
            "application" => Ok(Self::Application),
            "file" => Ok(Self::File),
            "directory" => Ok(Self::Directory),
            _ => Err(IndexerError::new(
                "database_error",
                format!("unknown indexed kind: {value}"),
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSource {
    pub id: String,
    pub root: PathBuf,
    pub kinds: Vec<IndexKind>,
    #[serde(default = "default_true")]
    pub respect_git_ignore: bool,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub follow_symlinks: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_depth: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IgnoreRuleKind {
    Glob,
    Regex,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreRule {
    pub kind: IgnoreRuleKind,
    pub pattern: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexConfiguration {
    pub sources: Vec<IndexSource>,
    #[serde(default)]
    pub custom_ignores: Vec<IgnoreRule>,
    #[serde(default = "default_max_entries")]
    pub max_entries: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRecord {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub kind: IndexKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(default)]
    pub score: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub query: String,
    #[serde(default)]
    pub kinds: Vec<IndexKind>,
    #[serde(default = "default_query_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResponse {
    pub records: Vec<IndexRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindStatus {
    pub kind: IndexKind,
    pub count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_indexed_at_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub schema_version: i64,
    pub total_records: usize,
    pub kinds: Vec<KindStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReport {
    pub source_id: String,
    pub root: String,
    pub indexed: usize,
    pub skipped: usize,
    pub errors: usize,
    pub by_kind: BTreeMap<IndexKind, usize>,
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexReport {
    pub started_at_ms: i64,
    pub completed_at_ms: i64,
    pub duration_ms: u64,
    pub indexed: usize,
    pub skipped: usize,
    pub errors: usize,
    pub sources: Vec<SourceReport>,
    pub status: IndexStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub enum IndexerOperation {
    Status,
    Index { configuration: IndexConfiguration },
    Query { request: QueryRequest },
    Lookup { path: String, kind: IndexKind },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexerRequest {
    pub id: String,
    #[serde(flatten)]
    pub operation: IndexerOperation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexerSuccessResponse {
    pub id: String,
    pub ok: bool,
    pub result: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexerErrorBody {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexerErrorResponse {
    pub id: String,
    pub ok: bool,
    pub error: IndexerErrorBody,
}

pub struct IndexDatabase {
    connection: Connection,
}

impl IndexDatabase {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, IndexerError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        prepare_database_file(path)?;
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        let journal_mode: String = retry_database_busy(|| {
            connection.query_row("PRAGMA journal_mode", [], |row| row.get(0))
        })?;
        if !journal_mode.eq_ignore_ascii_case("wal") {
            retry_database_busy(|| connection.pragma_update(None, "journal_mode", "WAL"))?;
        }
        retry_database_busy(|| {
            connection.execute_batch(
                "PRAGMA synchronous=NORMAL;
                 PRAGMA temp_store=MEMORY;
                 PRAGMA foreign_keys=ON;",
            )
        })?;
        connection.pragma_update(
            None,
            "journal_size_limit",
            DATABASE_JOURNAL_SIZE_LIMIT_BYTES,
        )?;
        initialize_schema(&connection)?;
        secure_database_files(path)?;
        Ok(Self { connection })
    }

    pub fn index(
        &mut self,
        configuration: &IndexConfiguration,
    ) -> Result<IndexReport, IndexerError> {
        validate_configuration(configuration)?;
        let matcher = Arc::new(CustomIgnoreMatcher::compile(&configuration.custom_ignores)?);
        let started_at_ms = now_ms();
        let started = Instant::now();
        let mut reports = Vec::with_capacity(configuration.sources.len());

        for source in &configuration.sources {
            match self.index_source(source, Arc::clone(&matcher), configuration.max_entries) {
                Ok(report) => reports.push(report),
                Err(error) => {
                    self.record_source_error(source, &error.message)?;
                    return Err(error);
                }
            }
        }

        let indexed = reports.iter().map(|report| report.indexed).sum();
        let skipped = reports.iter().map(|report| report.skipped).sum();
        let errors = reports.iter().map(|report| report.errors).sum();
        let _ = self
            .connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        Ok(IndexReport {
            started_at_ms,
            completed_at_ms: now_ms(),
            duration_ms: duration_ms(started),
            indexed,
            skipped,
            errors,
            sources: reports,
            status: self.status()?,
        })
    }

    pub fn query(&self, request: &QueryRequest) -> Result<QueryResponse, IndexerError> {
        if request.limit == 0 {
            return Ok(QueryResponse {
                records: Vec::new(),
            });
        }
        if request.limit > MAX_QUERY_RESULTS {
            return Err(IndexerError::new(
                "invalid_request",
                format!("limit may not exceed {MAX_QUERY_RESULTS}"),
            ));
        }
        let kinds = normalized_kinds(&request.kinds);
        let mut records = if request.query.trim().chars().count() >= 3 {
            let mut matches = self.query_fts(request.query.trim(), &kinds, request.limit)?;
            if matches.is_empty() {
                matches = self.query_like(request.query.trim(), &kinds, request.limit)?;
            }
            matches
        } else {
            self.query_like(request.query.trim(), &kinds, request.limit)?
        };
        deduplicate_records(&mut records, request.limit);
        Ok(QueryResponse { records })
    }

    pub fn lookup(&self, path: &str, kind: IndexKind) -> Result<Option<IndexRecord>, IndexerError> {
        let mut statement = self.connection.prepare(
            "SELECT path, name, parent, kind, modified_at_ms, size
             FROM records WHERE path = ?1 AND kind = ?2 LIMIT 1",
        )?;
        statement
            .query_row(params![path, kind.as_str()], row_to_record)
            .optional()
            .map_err(Into::into)
    }

    pub fn status(&self) -> Result<IndexStatus, IndexerError> {
        let total_records: i64 = self.connection.query_row(
            "SELECT COUNT(DISTINCT path || char(0) || kind) FROM records",
            [],
            |row| row.get(0),
        )?;
        let mut kinds = Vec::new();
        for kind in [
            IndexKind::Application,
            IndexKind::File,
            IndexKind::Directory,
        ] {
            let count: i64 = self.connection.query_row(
                "SELECT COUNT(DISTINCT path) FROM records WHERE kind = ?1",
                [kind.as_str()],
                |row| row.get(0),
            )?;
            let status = self.connection.query_row(
                "SELECT MAX(last_indexed_at_ms), MAX(last_duration_ms),
                            MAX(CASE WHEN last_error IS NOT NULL THEN last_error END)
                     FROM source_status WHERE kind = ?1",
                [kind.as_str()],
                |row| {
                    Ok((
                        row.get::<_, Option<i64>>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )?;
            kinds.push(KindStatus {
                kind,
                count: usize::try_from(count).unwrap_or(usize::MAX),
                last_indexed_at_ms: status.0,
                last_duration_ms: status.1.and_then(|value| u64::try_from(value).ok()),
                last_error: status.2,
            });
        }
        Ok(IndexStatus {
            schema_version: SCHEMA_VERSION,
            total_records: usize::try_from(total_records).unwrap_or(usize::MAX),
            kinds,
        })
    }

    pub fn handle_request(
        &mut self,
        request: IndexerRequest,
    ) -> Result<IndexerSuccessResponse, IndexerError> {
        let result = match request.operation {
            IndexerOperation::Status => serde_json::to_value(self.status()?),
            IndexerOperation::Index { configuration } => {
                serde_json::to_value(self.index(&configuration)?)
            }
            IndexerOperation::Query { request } => serde_json::to_value(self.query(&request)?),
            IndexerOperation::Lookup { path, kind } => {
                serde_json::to_value(self.lookup(&path, kind)?)
            }
        }
        .map_err(|error| IndexerError::new("serialization_error", error.to_string()))?;
        Ok(IndexerSuccessResponse {
            id: request.id,
            ok: true,
            result,
        })
    }

    fn index_source(
        &mut self,
        source: &IndexSource,
        matcher: Arc<CustomIgnoreMatcher>,
        max_entries: usize,
    ) -> Result<SourceReport, IndexerError> {
        let root = fs::canonicalize(&source.root).map_err(|error| {
            IndexerError::new(
                "invalid_root",
                format!("cannot index {}: {error}", source.root.display()),
            )
        })?;
        if !root.is_dir() {
            return Err(IndexerError::new(
                "invalid_root",
                format!("index root is not a directory: {}", root.display()),
            ));
        }
        let root_text = path_text(&root)?;
        let generation = next_generation(&self.connection)?;
        let started = Instant::now();
        let indexed_at = now_ms();
        let transaction = self.connection.transaction()?;
        let report = scan_and_store(
            &transaction,
            source,
            &root,
            &root_text,
            matcher,
            max_entries,
            generation,
        )?;
        let scan_warning = report.diagnostics.first().map(String::as_str);

        for kind in normalized_kinds(&source.kinds) {
            transaction.execute(
                "DELETE FROM records
                 WHERE source_id = ?1 AND kind = ?2 AND generation <> ?3",
                params![source.id, kind.as_str(), generation],
            )?;
            let count: i64 = transaction.query_row(
                "SELECT COUNT(*) FROM records WHERE source_id = ?1 AND kind = ?2",
                params![source.id, kind.as_str()],
                |row| row.get(0),
            )?;
            transaction.execute(
                "INSERT INTO source_status
                   (source_id, root, kind, count, last_indexed_at_ms, last_duration_ms, last_error)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(source_id, kind) DO UPDATE SET
                   root = excluded.root,
                   count = excluded.count,
                   last_indexed_at_ms = excluded.last_indexed_at_ms,
                   last_duration_ms = excluded.last_duration_ms,
                   last_error = excluded.last_error",
                params![
                    source.id,
                    root_text,
                    kind.as_str(),
                    count,
                    indexed_at,
                    i64::try_from(duration_ms(started)).unwrap_or(i64::MAX),
                    scan_warning,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(report)
    }

    fn record_source_error(&self, source: &IndexSource, message: &str) -> Result<(), IndexerError> {
        for kind in normalized_kinds(&source.kinds) {
            self.connection.execute(
                "INSERT INTO source_status
                   (source_id, root, kind, count, last_error)
                 VALUES (?1, ?2, ?3, 0, ?4)
                 ON CONFLICT(source_id, kind) DO UPDATE SET last_error = excluded.last_error",
                params![
                    source.id,
                    source.root.to_string_lossy(),
                    kind.as_str(),
                    message
                ],
            )?;
        }
        Ok(())
    }

    fn query_fts(
        &self,
        query: &str,
        kinds: &[IndexKind],
        limit: usize,
    ) -> Result<Vec<IndexRecord>, IndexerError> {
        let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
        let expanded_limit = limit.saturating_mul(4).min(MAX_QUERY_RESULTS * 4);
        let mut statement = self.connection.prepare(
            "SELECT r.path, r.name, r.parent, r.kind, r.modified_at_ms, r.size,
                    CASE
                      WHEN lower(r.name) = lower(?2) THEN 100000
                      WHEN lower(r.name) LIKE lower(?2) || '%' THEN 80000 - length(r.name)
                      WHEN instr(lower(r.name), lower(?2)) > 0 THEN 60000 - instr(lower(r.name), lower(?2))
                      ELSE 30000 - MIN(instr(lower(r.path), lower(?2)), 20000)
                    END AS result_score
             FROM records_fts
             JOIN records r ON r.rowid = records_fts.rowid
             WHERE records_fts MATCH ?1
               AND ((?3 = 1 AND r.kind = 'application')
                 OR (?4 = 1 AND r.kind = 'file')
                 OR (?5 = 1 AND r.kind = 'directory'))
             ORDER BY result_score DESC, bm25(records_fts), lower(r.name), r.path
             LIMIT ?6",
        )?;
        let flags = kind_flags(kinds);
        let rows = statement.query_map(
            params![
                fts_query,
                query,
                flags.0,
                flags.1,
                flags.2,
                i64::try_from(expanded_limit).unwrap_or(i64::MAX)
            ],
            |row| {
                let mut record = row_to_record(row)?;
                record.score = row.get(6)?;
                Ok(record)
            },
        )?;
        collect_rows(rows)
    }

    fn query_like(
        &self,
        query: &str,
        kinds: &[IndexKind],
        limit: usize,
    ) -> Result<Vec<IndexRecord>, IndexerError> {
        let expanded_limit = limit.saturating_mul(4).min(MAX_QUERY_RESULTS * 4);
        let contains = format!("%{}%", escape_like(query));
        let prefix = format!("{}%", escape_like(query));
        let mut statement = self.connection.prepare(
            "SELECT path, name, parent, kind, modified_at_ms, size,
                    CASE
                      WHEN ?1 = '' THEN 1000
                      WHEN lower(name) = lower(?1) THEN 100000
                      WHEN lower(name) LIKE lower(?2) ESCAPE '\\' THEN 80000 - length(name)
                      WHEN lower(name) LIKE lower(?3) ESCAPE '\\' THEN 60000 - instr(lower(name), lower(?1))
                      ELSE 30000 - MIN(instr(lower(path), lower(?1)), 20000)
                    END AS result_score
             FROM records
             WHERE (?1 = '' OR lower(name) LIKE lower(?3) ESCAPE '\\'
                              OR lower(path) LIKE lower(?3) ESCAPE '\\')
               AND ((?4 = 1 AND kind = 'application')
                 OR (?5 = 1 AND kind = 'file')
                 OR (?6 = 1 AND kind = 'directory'))
             ORDER BY result_score DESC, lower(name), path
             LIMIT ?7",
        )?;
        let flags = kind_flags(kinds);
        let rows = statement.query_map(
            params![
                query,
                prefix,
                contains,
                flags.0,
                flags.1,
                flags.2,
                i64::try_from(expanded_limit).unwrap_or(i64::MAX)
            ],
            |row| {
                let mut record = row_to_record(row)?;
                record.score = row.get(6)?;
                Ok(record)
            },
        )?;
        collect_rows(rows)
    }
}

fn initialize_schema(connection: &Connection) -> Result<(), IndexerError> {
    let schema_is_complete: bool = retry_database_busy(|| {
        connection.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'source_status'
             ) AND EXISTS(
               SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'records_fts'
             )",
            [],
            |row| row.get(0),
        )
    })?;
    if !schema_is_complete {
        retry_database_busy(|| {
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS metadata (
           key TEXT PRIMARY KEY,
           value INTEGER NOT NULL
         );
         INSERT INTO metadata(key, value) VALUES ('schema_version', 2)
           ON CONFLICT(key) DO NOTHING;
         INSERT INTO metadata(key, value) VALUES ('generation', 0)
           ON CONFLICT(key) DO NOTHING;

         CREATE TABLE IF NOT EXISTS records (
           rowid INTEGER PRIMARY KEY,
           source_id TEXT NOT NULL,
           path TEXT NOT NULL,
           name TEXT NOT NULL,
           parent TEXT NOT NULL,
           kind TEXT NOT NULL CHECK(kind IN ('application', 'file', 'directory')),
           modified_at_ms INTEGER,
           size INTEGER,
           generation INTEGER NOT NULL,
           UNIQUE(source_id, path, kind)
         );
         CREATE INDEX IF NOT EXISTS records_kind_name ON records(kind, name COLLATE NOCASE);
         CREATE INDEX IF NOT EXISTS records_path_kind ON records(path, kind);
         CREATE INDEX IF NOT EXISTS records_source_generation
           ON records(source_id, kind, generation);

         CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
           name,
           content='records',
           content_rowid='rowid',
           tokenize='trigram'
         );
         CREATE TRIGGER IF NOT EXISTS records_after_insert AFTER INSERT ON records BEGIN
           INSERT INTO records_fts(rowid, name)
           VALUES (new.rowid, new.name);
         END;
         CREATE TRIGGER IF NOT EXISTS records_after_delete AFTER DELETE ON records BEGIN
           INSERT INTO records_fts(records_fts, rowid, name)
           VALUES ('delete', old.rowid, old.name);
         END;
         CREATE TRIGGER IF NOT EXISTS records_after_update AFTER UPDATE ON records BEGIN
           INSERT INTO records_fts(records_fts, rowid, name)
           VALUES ('delete', old.rowid, old.name);
           INSERT INTO records_fts(rowid, name)
           VALUES (new.rowid, new.name);
         END;

         CREATE TABLE IF NOT EXISTS source_status (
           source_id TEXT NOT NULL,
           root TEXT NOT NULL,
           kind TEXT NOT NULL,
           count INTEGER NOT NULL DEFAULT 0,
           last_indexed_at_ms INTEGER,
           last_duration_ms INTEGER,
           last_error TEXT,
           PRIMARY KEY(source_id, kind)
         );",
            )
        })?;
    }
    let mut schema_version: i64 = connection.query_row(
        "SELECT value FROM metadata WHERE key = 'schema_version'",
        [],
        |row| row.get(0),
    )?;
    if schema_version == 1 {
        migrate_name_only_fts(connection)?;
        schema_version = SCHEMA_VERSION;
    }
    if schema_version != SCHEMA_VERSION {
        return Err(IndexerError::new(
            "unsupported_schema",
            format!("database schema {schema_version} is not supported"),
        ));
    }
    Ok(())
}

fn migrate_name_only_fts(connection: &Connection) -> Result<(), IndexerError> {
    retry_database_busy(|| {
        connection.execute_batch(
            "BEGIN IMMEDIATE;
             DROP TRIGGER IF EXISTS records_after_insert;
             DROP TRIGGER IF EXISTS records_after_delete;
             DROP TRIGGER IF EXISTS records_after_update;
             DROP TABLE IF EXISTS records_fts;
             CREATE VIRTUAL TABLE records_fts USING fts5(
               name,
               content='records',
               content_rowid='rowid',
               tokenize='trigram'
             );
             CREATE TRIGGER records_after_insert AFTER INSERT ON records BEGIN
               INSERT INTO records_fts(rowid, name) VALUES (new.rowid, new.name);
             END;
             CREATE TRIGGER records_after_delete AFTER DELETE ON records BEGIN
               INSERT INTO records_fts(records_fts, rowid, name)
               VALUES ('delete', old.rowid, old.name);
             END;
             CREATE TRIGGER records_after_update AFTER UPDATE ON records BEGIN
               INSERT INTO records_fts(records_fts, rowid, name)
               VALUES ('delete', old.rowid, old.name);
               INSERT INTO records_fts(rowid, name) VALUES (new.rowid, new.name);
             END;
             INSERT INTO records_fts(records_fts) VALUES ('rebuild');
             UPDATE metadata SET value = 2 WHERE key = 'schema_version';
             COMMIT;",
        )
    })?;
    Ok(())
}

fn retry_database_busy<T>(
    mut operation: impl FnMut() -> rusqlite::Result<T>,
) -> rusqlite::Result<T> {
    for attempt in 0..DATABASE_OPEN_RETRY_ATTEMPTS {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error)
                if attempt + 1 < DATABASE_OPEN_RETRY_ATTEMPTS && is_database_busy(&error) =>
            {
                std::thread::sleep(DATABASE_OPEN_RETRY_DELAY);
            }
            Err(error) => return Err(error),
        }
    }
    unreachable!("database initialization retry loop always returns")
}

fn is_database_busy(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _)
            if matches!(failure.code, ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
    )
}

fn scan_and_store(
    transaction: &Transaction<'_>,
    source: &IndexSource,
    root: &Path,
    root_text: &str,
    matcher: Arc<CustomIgnoreMatcher>,
    max_entries: usize,
    generation: i64,
) -> Result<SourceReport, IndexerError> {
    let mut builder = WalkBuilder::new(root);
    builder
        // One deterministic traversal worker guarantees that reaching the
        // entry cap cannot be held open by another worker already blocked in
        // a slow File Provider directory. SQLite writes remain the dominant
        // cost, and callers can run independent databases concurrently.
        .threads(1)
        .hidden(!source.include_hidden)
        .follow_links(source.follow_symlinks)
        .ignore(source.respect_git_ignore)
        .parents(source.respect_git_ignore)
        .git_ignore(source.respect_git_ignore)
        .git_global(source.respect_git_ignore)
        .git_exclude(source.respect_git_ignore);
    if let Some(max_depth) = source.max_depth {
        builder.max_depth(Some(max_depth));
    }
    let walker = builder.build_parallel();
    let kinds: HashSet<IndexKind> = normalized_kinds(&source.kinds).into_iter().collect();
    let (sender, receiver) = mpsc::sync_channel::<ScanMessage>(1_024);
    let cancelled = Arc::new(AtomicBool::new(false));
    let discovered = Arc::new(AtomicUsize::new(0));
    let root_owned = root.to_path_buf();
    let source_id = source.id.clone();
    let mut report = SourceReport {
        source_id: source.id.clone(),
        root: root_text.to_owned(),
        indexed: 0,
        skipped: 0,
        errors: 0,
        by_kind: BTreeMap::new(),
        diagnostics: Vec::new(),
    };

    std::thread::scope(|scope| -> Result<(), IndexerError> {
        let walker_sender = sender.clone();
        let walker_cancelled = Arc::clone(&cancelled);
        let walker_discovered = Arc::clone(&discovered);
        scope.spawn(move || {
            walker.run(|| {
                let sender = walker_sender.clone();
                let cancelled = Arc::clone(&walker_cancelled);
                let discovered = Arc::clone(&walker_discovered);
                let matcher = Arc::clone(&matcher);
                let kinds = kinds.clone();
                let root = root_owned.clone();
                Box::new(move |entry| {
                    if cancelled.load(Ordering::Relaxed) {
                        return WalkState::Quit;
                    }
                    let entry = match entry {
                        Ok(entry) => entry,
                        Err(error) => {
                            let _ = sender.send(ScanMessage::WalkError(error.to_string()));
                            return WalkState::Continue;
                        }
                    };
                    let path = entry.path();
                    let relative = path.strip_prefix(&root).unwrap_or(path);
                    if entry.depth() > 0 && matcher.is_match(path, relative) {
                        let _ = sender.send(ScanMessage::Skipped);
                        return if entry
                            .file_type()
                            .is_some_and(|file_type| file_type.is_dir())
                        {
                            WalkState::Skip
                        } else {
                            WalkState::Continue
                        };
                    }
                    let (candidate, skip_children) = match candidate_from_entry(&entry, &kinds) {
                        Ok(result) => result,
                        Err(error) => {
                            let _ = sender.send(ScanMessage::WalkError(error.message));
                            return WalkState::Continue;
                        }
                    };
                    if let Some(candidate) = candidate {
                        let next = discovered.fetch_add(1, Ordering::Relaxed) + 1;
                        if next > max_entries {
                            cancelled.store(true, Ordering::Relaxed);
                            let _ = sender.send(ScanMessage::LimitExceeded);
                            return WalkState::Quit;
                        }
                        if sender.send(ScanMessage::Record(candidate)).is_err() {
                            cancelled.store(true, Ordering::Relaxed);
                            return WalkState::Quit;
                        }
                    }
                    if skip_children {
                        WalkState::Skip
                    } else {
                        WalkState::Continue
                    }
                })
            });
        });
        drop(sender);

        let mut insert = transaction.prepare_cached(
            "INSERT INTO records
               (source_id, path, name, parent, kind, modified_at_ms, size, generation)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(source_id, path, kind) DO UPDATE SET
               name = excluded.name,
               parent = excluded.parent,
               modified_at_ms = excluded.modified_at_ms,
               size = excluded.size,
               generation = excluded.generation",
        )?;
        let mut limit_reported = false;
        for message in receiver {
            match message {
                ScanMessage::Record(record) => {
                    if let Err(error) = insert.execute(params![
                        source_id,
                        record.path,
                        record.name,
                        record.parent,
                        record.kind.as_str(),
                        record.modified_at_ms,
                        record.size.and_then(|size| i64::try_from(size).ok()),
                        generation,
                    ]) {
                        cancelled.store(true, Ordering::Relaxed);
                        return Err(error.into());
                    }
                    report.indexed += 1;
                    *report.by_kind.entry(record.kind).or_insert(0) += 1;
                }
                ScanMessage::Skipped => report.skipped += 1,
                ScanMessage::WalkError(message) => {
                    report.errors += 1;
                    if report.diagnostics.len() < MAX_DIAGNOSTICS {
                        report.diagnostics.push(message);
                    }
                }
                ScanMessage::LimitExceeded => {
                    cancelled.store(true, Ordering::Relaxed);
                    if !limit_reported {
                        limit_reported = true;
                        report.errors += 1;
                        report.diagnostics.push(format!(
                            "Index capped at {max_entries} entries for source {}; add an ignore rule or use a narrower root to include omitted items",
                            source.id
                        ));
                    }
                }
            }
        }
        Ok(())
    })?;
    Ok(report)
}

enum ScanMessage {
    Record(CandidateRecord),
    Skipped,
    WalkError(String),
    LimitExceeded,
}

#[derive(Debug)]
struct CandidateRecord {
    path: String,
    name: String,
    parent: String,
    kind: IndexKind,
    modified_at_ms: Option<i64>,
    size: Option<u64>,
}

fn candidate_from_entry(
    entry: &ignore::DirEntry,
    kinds: &HashSet<IndexKind>,
) -> Result<(Option<CandidateRecord>, bool), IndexerError> {
    let Some(file_type) = entry.file_type() else {
        return Ok((None, false));
    };
    let path = entry.path();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_else(|| path.to_str().unwrap_or(""));
    let metadata = entry.metadata().ok();
    let application = application_kind(path, file_type.is_dir(), file_type.is_file());
    let opaque_package = file_type.is_dir() && opaque_package_directory(path);
    let dataless_directory =
        file_type.is_dir() && metadata.as_ref().is_some_and(metadata_is_dataless);
    let skip_children = file_type.is_dir() && (application || opaque_package || dataless_directory);
    let kind = if application && kinds.contains(&IndexKind::Application) {
        Some(IndexKind::Application)
    } else if file_type.is_dir() && kinds.contains(&IndexKind::Directory) && !application {
        Some(IndexKind::Directory)
    } else if file_type.is_file() && kinds.contains(&IndexKind::File) && !application {
        Some(IndexKind::File)
    } else {
        None
    };
    let Some(kind) = kind else {
        return Ok((None, skip_children));
    };
    let absolute_path = path_text(path)?;
    let parent = path
        .parent()
        .map(path_text)
        .transpose()?
        .unwrap_or_default();
    let display_name = if kind == IndexKind::Application {
        strip_application_extension(name).to_owned()
    } else {
        name.to_owned()
    };
    let modified_at_ms = metadata
        .as_ref()
        .and_then(|value| value.modified().ok())
        .and_then(system_time_ms);
    let size = metadata
        .as_ref()
        .filter(|_| kind == IndexKind::File)
        .map(fs::Metadata::len);
    Ok((
        Some(CandidateRecord {
            path: absolute_path,
            name: display_name,
            parent,
            kind,
            modified_at_ms,
            size,
        }),
        skip_children,
    ))
}

#[cfg(target_os = "macos")]
fn metadata_is_dataless(metadata: &fs::Metadata) -> bool {
    // UF_DATALESS marks an on-demand File Provider placeholder. Descending into
    // it can hydrate cloud data or block indefinitely, while indexing the
    // directory reference itself is safe and useful.
    const UF_DATALESS: u32 = 0x4000_0000;
    metadata.st_flags() & UF_DATALESS != 0
}

#[cfg(not(target_os = "macos"))]
fn metadata_is_dataless(_metadata: &fs::Metadata) -> bool {
    false
}

fn application_kind(path: &Path, is_directory: bool, is_file: bool) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    (is_directory && extension == "app")
        || (is_file && matches!(extension.as_str(), "exe" | "desktop"))
}

fn opaque_package_directory(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "appex"
            | "band"
            | "bundle"
            | "fcpbundle"
            | "framework"
            | "imovielibrary"
            | "kext"
            | "key"
            | "logicx"
            | "musiclibrary"
            | "numbers"
            | "pages"
            | "photolibrary"
            | "photoslibrary"
            | "pkg"
            | "playground"
            | "plugin"
            | "rtfd"
            | "xcassets"
            | "xcframework"
            | "xcodeproj"
            | "xcworkspace"
    )
}

fn strip_application_extension(name: &str) -> &str {
    for extension in [".app", ".exe", ".desktop"] {
        if name
            .get(name.len().saturating_sub(extension.len())..)
            .is_some_and(|suffix| suffix.eq_ignore_ascii_case(extension))
        {
            return &name[..name.len() - extension.len()];
        }
    }
    name
}

struct CustomIgnoreMatcher {
    globs: GlobSet,
    regexes: RegexSet,
}

impl CustomIgnoreMatcher {
    fn compile(rules: &[IgnoreRule]) -> Result<Self, IndexerError> {
        let mut glob_builder = GlobSetBuilder::new();
        let mut regex_patterns = Vec::new();
        for (index, rule) in rules.iter().enumerate() {
            if rule.pattern.is_empty() {
                return Err(IndexerError::new(
                    "invalid_ignore_rule",
                    format!("ignore rule {} has an empty pattern", index + 1),
                ));
            }
            match rule.kind {
                IgnoreRuleKind::Glob => {
                    let mut patterns = vec![rule.pattern.as_str()];
                    if let Some(directory_pattern) = rule.pattern.strip_suffix("/**") {
                        if !directory_pattern.is_empty() {
                            patterns.push(directory_pattern);
                        }
                    }
                    for pattern in patterns {
                        let glob = GlobBuilder::new(pattern)
                            .literal_separator(false)
                            .backslash_escape(true)
                            .build()
                            .map_err(|error| {
                                IndexerError::new(
                                    "invalid_ignore_rule",
                                    format!("invalid glob at rule {}: {error}", index + 1),
                                )
                            })?;
                        glob_builder.add(glob);
                    }
                }
                IgnoreRuleKind::Regex => regex_patterns.push(rule.pattern.clone()),
            }
        }
        let globs = glob_builder.build().map_err(|error| {
            IndexerError::new("invalid_ignore_rule", format!("invalid glob set: {error}"))
        })?;
        let regexes = RegexSet::new(&regex_patterns).map_err(|error| {
            IndexerError::new(
                "invalid_ignore_rule",
                format!("invalid regular expression: {error}"),
            )
        })?;
        Ok(Self { globs, regexes })
    }

    fn is_match(&self, absolute: &Path, relative: &Path) -> bool {
        let absolute = slash_path(absolute);
        let relative = slash_path(relative);
        let basename = relative.rsplit('/').next().unwrap_or(&relative);
        self.globs.is_match(&absolute)
            || self.globs.is_match(&relative)
            || self.globs.is_match(basename)
            || self.regexes.is_match(&absolute)
            || self.regexes.is_match(&relative)
            || self.regexes.is_match(basename)
    }
}

fn validate_configuration(configuration: &IndexConfiguration) -> Result<(), IndexerError> {
    if configuration.sources.is_empty() {
        return Err(IndexerError::new(
            "invalid_configuration",
            "at least one index source is required",
        ));
    }
    if configuration.sources.len() > MAX_SOURCES {
        return Err(IndexerError::new(
            "invalid_configuration",
            format!("at most {MAX_SOURCES} index sources are allowed"),
        ));
    }
    if configuration.custom_ignores.len() > MAX_IGNORE_RULES {
        return Err(IndexerError::new(
            "invalid_configuration",
            format!("at most {MAX_IGNORE_RULES} custom ignore rules are allowed"),
        ));
    }
    if configuration.max_entries == 0 || configuration.max_entries > HARD_MAX_ENTRIES {
        return Err(IndexerError::new(
            "invalid_configuration",
            format!("maxEntries must be between 1 and {HARD_MAX_ENTRIES}"),
        ));
    }
    let mut ids = HashSet::new();
    for source in &configuration.sources {
        if source.id.trim().is_empty() || source.id.len() > 256 {
            return Err(IndexerError::new(
                "invalid_configuration",
                "source IDs must contain between 1 and 256 bytes",
            ));
        }
        if !ids.insert(source.id.as_str()) {
            return Err(IndexerError::new(
                "invalid_configuration",
                format!("duplicate source ID: {}", source.id),
            ));
        }
        if source.kinds.is_empty() {
            return Err(IndexerError::new(
                "invalid_configuration",
                format!("source {} has no index kinds", source.id),
            ));
        }
    }
    CustomIgnoreMatcher::compile(&configuration.custom_ignores)?;
    Ok(())
}

fn next_generation(connection: &Connection) -> Result<i64, IndexerError> {
    connection.execute(
        "UPDATE metadata SET value = value + 1 WHERE key = 'generation'",
        [],
    )?;
    connection
        .query_row(
            "SELECT value FROM metadata WHERE key = 'generation'",
            [],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn normalized_kinds(kinds: &[IndexKind]) -> Vec<IndexKind> {
    let mut normalized = if kinds.is_empty() {
        vec![
            IndexKind::Application,
            IndexKind::File,
            IndexKind::Directory,
        ]
    } else {
        kinds.to_vec()
    };
    normalized.sort_unstable();
    normalized.dedup();
    normalized
}

fn kind_flags(kinds: &[IndexKind]) -> (i64, i64, i64) {
    (
        i64::from(kinds.contains(&IndexKind::Application)),
        i64::from(kinds.contains(&IndexKind::File)),
        i64::from(kinds.contains(&IndexKind::Directory)),
    )
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<IndexRecord> {
    let kind_text: String = row.get(3)?;
    let kind = IndexKind::from_database(&kind_text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let size = row
        .get::<_, Option<i64>>(5)?
        .and_then(|value| u64::try_from(value).ok());
    Ok(IndexRecord {
        path: row.get(0)?,
        name: row.get(1)?,
        parent: row.get(2)?,
        kind,
        modified_at_ms: row.get(4)?,
        size,
        score: 0,
    })
}

fn collect_rows(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<IndexRecord>>,
) -> Result<Vec<IndexRecord>, IndexerError> {
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn deduplicate_records(records: &mut Vec<IndexRecord>, limit: usize) {
    let mut seen = HashSet::new();
    records.retain(|record| seen.insert((record.path.clone(), record.kind)));
    records.truncate(limit);
}

fn path_text(path: &Path) -> Result<String, IndexerError> {
    path.to_str().map(ToOwned::to_owned).ok_or_else(|| {
        IndexerError::new(
            "unsupported_path",
            format!("path is not valid UTF-8: {}", path.display()),
        )
    })
}

fn slash_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn system_time_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn duration_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn default_true() -> bool {
    true
}

fn default_max_entries() -> usize {
    DEFAULT_MAX_ENTRIES
}

fn default_query_limit() -> usize {
    50
}

#[cfg(unix)]
fn prepare_database_file(path: &Path) -> Result<(), IndexerError> {
    use std::fs::OpenOptions;
    use std::os::unix::fs::OpenOptionsExt;

    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
    {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            secure_database_file(path)
        }
        Err(error) => Err(error.into()),
    }
}

#[cfg(not(unix))]
fn prepare_database_file(_path: &Path) -> Result<(), IndexerError> {
    Ok(())
}

#[cfg(unix)]
fn secure_database_file(path: &Path) -> Result<(), IndexerError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn secure_database_file(_path: &Path) -> Result<(), IndexerError> {
    Ok(())
}

fn secure_database_files(path: &Path) -> Result<(), IndexerError> {
    secure_database_file(path)?;
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(suffix);
        let sidecar = PathBuf::from(sidecar);
        if sidecar.exists() {
            secure_database_file(&sidecar)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, write};
    use std::sync::Barrier;
    use tempfile::TempDir;

    fn database(temp: &TempDir) -> IndexDatabase {
        IndexDatabase::open(temp.path().join(".state/index.sqlite3")).expect("open index")
    }

    fn configuration(root: &Path, kinds: Vec<IndexKind>) -> IndexConfiguration {
        IndexConfiguration {
            sources: vec![IndexSource {
                id: "test".to_owned(),
                root: root.to_path_buf(),
                kinds,
                respect_git_ignore: true,
                include_hidden: false,
                follow_symlinks: false,
                max_depth: None,
            }],
            custom_ignores: Vec::new(),
            max_entries: 10_000,
        }
    }

    #[test]
    fn concurrent_clients_can_initialize_the_same_database() {
        let temp = TempDir::new().expect("tempdir");
        let database_path = Arc::new(temp.path().join(".state/index.sqlite3"));
        let barrier = Arc::new(Barrier::new(8));
        let clients = (0..8)
            .map(|_| {
                let database_path = Arc::clone(&database_path);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    let database = IndexDatabase::open(database_path.as_ref()).expect("open index");
                    database.status().expect("read status")
                })
            })
            .collect::<Vec<_>>();

        for client in clients {
            let status = client.join().expect("client thread");
            assert_eq!(status.schema_version, SCHEMA_VERSION);
            assert_eq!(status.total_records, 0);
        }
    }

    #[cfg(unix)]
    #[test]
    fn database_and_live_sidecars_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new().expect("tempdir");
        let database_path = temp.path().join(".state/index.sqlite3");
        let _database = IndexDatabase::open(&database_path).expect("open index");
        for suffix in ["", "-wal", "-shm"] {
            let mut candidate = database_path.as_os_str().to_os_string();
            candidate.push(suffix);
            let candidate = PathBuf::from(candidate);
            if candidate.exists() {
                let mode = fs::metadata(candidate)
                    .expect("metadata")
                    .permissions()
                    .mode();
                assert_eq!(mode & 0o777, 0o600);
            }
        }
    }

    #[test]
    fn version_one_path_fts_is_migrated_to_the_name_only_index() {
        let temp = TempDir::new().expect("tempdir");
        write(temp.path().join("keep.txt"), "keep").expect("file");
        let database_path = temp.path().join(".state/index.sqlite3");
        let mut legacy = IndexDatabase::open(&database_path).expect("open index");
        legacy
            .index(&configuration(temp.path(), vec![IndexKind::File]))
            .expect("index");
        legacy
            .connection
            .execute_batch(
                "DROP TRIGGER records_after_insert;
                 DROP TRIGGER records_after_delete;
                 DROP TRIGGER records_after_update;
                 DROP TABLE records_fts;
                 CREATE VIRTUAL TABLE records_fts USING fts5(
                   name, path, kind UNINDEXED, source_id UNINDEXED,
                   content='records', content_rowid='rowid', tokenize='trigram'
                 );
                 CREATE TRIGGER records_after_insert AFTER INSERT ON records BEGIN
                   INSERT INTO records_fts(rowid, name, path, kind, source_id)
                   VALUES (new.rowid, new.name, new.path, new.kind, new.source_id);
                 END;
                 CREATE TRIGGER records_after_delete AFTER DELETE ON records BEGIN
                   INSERT INTO records_fts(records_fts, rowid, name, path, kind, source_id)
                   VALUES ('delete', old.rowid, old.name, old.path, old.kind, old.source_id);
                 END;
                 CREATE TRIGGER records_after_update AFTER UPDATE ON records BEGIN
                   INSERT INTO records_fts(records_fts, rowid, name, path, kind, source_id)
                   VALUES ('delete', old.rowid, old.name, old.path, old.kind, old.source_id);
                   INSERT INTO records_fts(rowid, name, path, kind, source_id)
                   VALUES (new.rowid, new.name, new.path, new.kind, new.source_id);
                 END;
                 INSERT INTO records_fts(records_fts) VALUES ('rebuild');
                 UPDATE metadata SET value = 1 WHERE key = 'schema_version';",
            )
            .expect("downgrade fixture");
        drop(legacy);

        let migrated = IndexDatabase::open(&database_path).expect("migrate index");
        assert_eq!(migrated.status().expect("status").schema_version, 2);
        let definition: String = migrated
            .connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name = 'records_fts'",
                [],
                |row| row.get(0),
            )
            .expect("fts definition");
        assert!(!definition.contains("path"));
        let results = migrated
            .query(&QueryRequest {
                query: "keep".to_owned(),
                kinds: vec![IndexKind::File],
                limit: 20,
            })
            .expect("query");
        assert_eq!(results.records.len(), 1);
        assert_eq!(results.records[0].name, "keep.txt");
    }

    #[test]
    fn inherited_gitignore_rules_are_applied_above_the_index_root() {
        let temp = TempDir::new().expect("tempdir");
        create_dir_all(temp.path().join(".git")).expect("git marker");
        create_dir_all(temp.path().join("workspace/nested")).expect("nested root");
        write(temp.path().join(".gitignore"), "*.secret\n").expect("gitignore");
        write(temp.path().join("workspace/nested/visible.txt"), "visible").expect("visible");
        write(
            temp.path().join("workspace/nested/private.secret"),
            "private",
        )
        .expect("private");

        let mut database = database(&temp);
        database
            .index(&configuration(
                &temp.path().join("workspace/nested"),
                vec![IndexKind::File],
            ))
            .expect("index");
        let results = database
            .query(&QueryRequest {
                query: String::new(),
                kinds: vec![IndexKind::File],
                limit: 20,
            })
            .expect("query");
        let names: Vec<_> = results
            .records
            .iter()
            .map(|record| record.name.as_str())
            .collect();
        assert_eq!(names, ["visible.txt"]);
    }

    #[test]
    fn custom_glob_and_regex_rules_are_both_enforced() {
        let temp = TempDir::new().expect("tempdir");
        create_dir_all(temp.path().join("cache")).expect("cache");
        write(temp.path().join("cache/skip.txt"), "skip").expect("skip");
        write(temp.path().join("draft-42.txt"), "skip").expect("draft");
        write(temp.path().join("keep.txt"), "keep").expect("keep");
        let mut config = configuration(temp.path(), vec![IndexKind::File, IndexKind::Directory]);
        config.custom_ignores = vec![
            IgnoreRule {
                kind: IgnoreRuleKind::Glob,
                pattern: "**/cache/**".to_owned(),
            },
            IgnoreRule {
                kind: IgnoreRuleKind::Regex,
                pattern: r"(^|/)draft-[0-9]+\.txt$".to_owned(),
            },
        ];

        let mut database = database(&temp);
        database.index(&config).expect("index");
        let results = database
            .query(&QueryRequest {
                query: String::new(),
                kinds: vec![IndexKind::File],
                limit: 20,
            })
            .expect("query");
        assert_eq!(results.records.len(), 1);
        assert_eq!(results.records[0].name, "keep.txt");
    }

    #[test]
    fn descendant_globs_also_prune_the_matching_directory() {
        let matcher = CustomIgnoreMatcher::compile(&[IgnoreRule {
            kind: IgnoreRuleKind::Glob,
            pattern: "**/node_modules/**".to_owned(),
        }])
        .expect("compile ignore rule");

        assert!(matcher.is_match(
            Path::new("/Users/example/project/node_modules"),
            Path::new("project/node_modules")
        ));
        assert!(matcher.is_match(
            Path::new("/Users/example/project/node_modules/library/index.js"),
            Path::new("project/node_modules/library/index.js")
        ));
    }

    #[test]
    fn application_bundles_are_indexed_without_walking_their_contents() {
        let temp = TempDir::new().expect("tempdir");
        create_dir_all(temp.path().join("Example.app/Contents/MacOS")).expect("app");
        write(
            temp.path().join("Example.app/Contents/MacOS/example"),
            "binary",
        )
        .expect("binary");
        let mut database = database(&temp);
        database
            .index(&configuration(
                temp.path(),
                vec![
                    IndexKind::Application,
                    IndexKind::File,
                    IndexKind::Directory,
                ],
            ))
            .expect("index");
        let applications = database
            .query(&QueryRequest {
                query: "Example".to_owned(),
                kinds: vec![IndexKind::Application],
                limit: 20,
            })
            .expect("query apps");
        assert_eq!(applications.records.len(), 1);
        assert_eq!(applications.records[0].name, "Example");
        let files = database
            .query(&QueryRequest {
                query: "example".to_owned(),
                kinds: vec![IndexKind::File],
                limit: 20,
            })
            .expect("query files");
        assert!(files.records.is_empty());
    }

    #[test]
    fn macos_package_directories_are_indexed_without_walking_their_contents() {
        let temp = TempDir::new().expect("tempdir");
        create_dir_all(temp.path().join("Media.photoslibrary/originals")).expect("photo library");
        write(
            temp.path()
                .join("Media.photoslibrary/originals/private.jpg"),
            "image",
        )
        .expect("image");
        let mut database = database(&temp);
        database
            .index(&configuration(
                temp.path(),
                vec![IndexKind::File, IndexKind::Directory],
            ))
            .expect("index");

        let directories = database
            .query(&QueryRequest {
                query: "Media".to_owned(),
                kinds: vec![IndexKind::Directory],
                limit: 20,
            })
            .expect("directories");
        assert_eq!(directories.records.len(), 1);
        assert_eq!(directories.records[0].name, "Media.photoslibrary");
        let files = database
            .query(&QueryRequest {
                query: "private".to_owned(),
                kinds: vec![IndexKind::File],
                limit: 20,
            })
            .expect("files");
        assert!(files.records.is_empty());
    }

    #[test]
    fn reindex_prunes_removed_records_without_touching_other_kinds() {
        let temp = TempDir::new().expect("tempdir");
        create_dir_all(temp.path().join("folder")).expect("folder");
        let file = temp.path().join("folder/note.txt");
        write(&file, "note").expect("file");
        let mut database = database(&temp);
        database
            .index(&configuration(
                temp.path(),
                vec![IndexKind::File, IndexKind::Directory],
            ))
            .expect("initial index");
        fs::remove_file(&file).expect("remove file");
        database
            .index(&configuration(temp.path(), vec![IndexKind::File]))
            .expect("file reindex");
        assert!(database
            .query(&QueryRequest {
                query: "note".to_owned(),
                kinds: vec![IndexKind::File],
                limit: 20,
            })
            .expect("query files")
            .records
            .is_empty());
        assert!(!database
            .query(&QueryRequest {
                query: "folder".to_owned(),
                kinds: vec![IndexKind::Directory],
                limit: 20,
            })
            .expect("query dirs")
            .records
            .is_empty());
    }

    #[test]
    fn fts_query_prioritizes_an_exact_name() {
        let temp = TempDir::new().expect("tempdir");
        write(temp.path().join("invoice.txt"), "one").expect("invoice");
        write(temp.path().join("invoice-archive.txt"), "two").expect("archive");
        let mut database = database(&temp);
        database
            .index(&configuration(temp.path(), vec![IndexKind::File]))
            .expect("index");
        let records = database
            .query(&QueryRequest {
                query: "invoice.txt".to_owned(),
                kinds: vec![IndexKind::File],
                limit: 20,
            })
            .expect("query")
            .records;
        assert_eq!(records[0].name, "invoice.txt");
    }

    #[test]
    fn path_search_falls_back_when_no_name_matches() {
        let temp = TempDir::new().expect("tempdir");
        create_dir_all(temp.path().join("invoices")).expect("folder");
        write(temp.path().join("invoices/receipt.pdf"), "receipt").expect("file");
        let mut database = database(&temp);
        database
            .index(&configuration(temp.path(), vec![IndexKind::File]))
            .expect("index");

        let records = database
            .query(&QueryRequest {
                query: "invoices".to_owned(),
                kinds: vec![IndexKind::File],
                limit: 20,
            })
            .expect("query")
            .records;
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].name, "receipt.pdf");
    }

    #[test]
    fn entry_cap_commits_a_searchable_partial_index_with_a_warning() {
        let temp = TempDir::new().expect("tempdir");
        for name in ["one.txt", "two.txt", "three.txt"] {
            write(temp.path().join(name), name).expect("file");
        }
        let mut config = configuration(temp.path(), vec![IndexKind::File]);
        config.max_entries = 2;
        let mut database = database(&temp);
        let report = database.index(&config).expect("capped index");

        assert_eq!(report.indexed, 2);
        assert_eq!(report.errors, 1);
        assert_eq!(report.status.total_records, 2);
        let file_status = report
            .status
            .kinds
            .iter()
            .find(|kind| kind.kind == IndexKind::File)
            .expect("file status");
        assert!(file_status
            .last_error
            .as_deref()
            .is_some_and(|message| message.contains("Index capped at 2 entries")));
    }

    #[test]
    fn invalid_regex_is_rejected_before_scanning() {
        let temp = TempDir::new().expect("tempdir");
        let mut config = configuration(temp.path(), vec![IndexKind::File]);
        config.custom_ignores.push(IgnoreRule {
            kind: IgnoreRuleKind::Regex,
            pattern: "(".to_owned(),
        });
        let error = database(&temp).index(&config).expect_err("invalid regex");
        assert_eq!(error.code, "invalid_ignore_rule");
    }

    #[test]
    fn protocol_request_echoes_the_correlation_id() {
        let temp = TempDir::new().expect("tempdir");
        let response = database(&temp)
            .handle_request(IndexerRequest {
                id: "request-7".to_owned(),
                operation: IndexerOperation::Status,
            })
            .expect("status");
        assert_eq!(response.id, "request-7");
        assert_eq!(response.result["schemaVersion"], SCHEMA_VERSION);
    }
}
