//! Persistent, portable filesystem metadata indexing for Thingtime desktop apps.
//!
//! The library keeps the scanning and storage boundary independent from any UI
//! host. [`IndexDatabase`] is used directly by the standalone CLI and by the
//! JSON-lines service consumed by Commander.

#![forbid(unsafe_code)]

use commander_core::fuzzy_text_score;
use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use ignore::{WalkBuilder, WalkState};
use regex::RegexSet;
use rusqlite::{
    params, params_from_iter, types::Value as SqlValue, Connection, ErrorCode, OptionalExtension,
    Transaction,
};
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

mod resources;

use resources::{validate_resource_limits, ResourceGovernor};
pub use resources::{EffectiveResourceLimits, IndexResourceLimits, IndexResourceUsage};

const SCHEMA_VERSION: i64 = 3;
const MAX_SOURCES: usize = 128;
const MAX_IGNORE_RULES: usize = 512;
const MAX_COARSE_QUERY_CHARACTERS: usize = 16;
const MAX_DIAGNOSTICS: usize = 20;
const DATABASE_OPEN_RETRY_ATTEMPTS: usize = 100;
const DATABASE_OPEN_RETRY_DELAY: Duration = Duration::from_millis(25);
const STRICT_FTS_BUDGET: Duration = Duration::from_millis(200);
const FUZZY_FTS_BUDGET: Duration = Duration::from_millis(350);
const COARSE_FUZZY_BUDGET: Duration = Duration::from_millis(350);
const PATH_FALLBACK_BUDGET: Duration = Duration::from_millis(250);
const DATABASE_JOURNAL_SIZE_LIMIT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_RESOURCE_MEMORY_MIB: usize = 131_072;

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
    #[serde(default = "default_true")]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_entries: Option<usize>,
    #[serde(default)]
    pub resource_limits: IndexResourceLimits,
    /// Optional source namespaces whose records should exactly match this
    /// configuration after a successful run. Commander uses this to remove
    /// stale results from an unplugged volume without touching another
    /// independently indexed namespace.
    #[serde(default)]
    pub prune_source_prefixes: Vec<String>,
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
    /// Maximum returned results, not a candidate-scan cap. Null returns all.
    pub limit: Option<usize>,
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
    pub database_size_bytes: u64,
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
pub struct IndexProgress {
    pub source_id: String,
    pub root: String,
    pub processed: usize,
    pub indexed: usize,
    pub skipped: usize,
    pub errors: usize,
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
    pub resources: IndexResourceUsage,
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
    database_path: PathBuf,
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
        Ok(Self {
            connection,
            database_path: path.to_path_buf(),
        })
    }

    pub fn index(
        &mut self,
        configuration: &IndexConfiguration,
    ) -> Result<IndexReport, IndexerError> {
        self.index_with_progress(configuration, &mut |_| Ok(()))
    }

    pub fn index_with_progress(
        &mut self,
        configuration: &IndexConfiguration,
        progress: &mut dyn FnMut(&IndexProgress) -> Result<(), IndexerError>,
    ) -> Result<IndexReport, IndexerError> {
        validate_configuration(configuration)?;
        let governor = Arc::new(ResourceGovernor::new(&configuration.resource_limits)?);
        configure_database_resources(&self.connection, governor.effective())?;
        let matcher = Arc::new(CustomIgnoreMatcher::compile(&configuration.custom_ignores)?);
        let started_at_ms = now_ms();
        let started = Instant::now();
        let mut reports = Vec::with_capacity(configuration.sources.len());

        for source in &configuration.sources {
            match self.index_source(
                source,
                Arc::clone(&matcher),
                configuration.max_entries,
                Arc::clone(&governor),
                progress,
            ) {
                Ok(report) => reports.push(report),
                Err(error) => {
                    self.record_source_error(source, &error.message)?;
                    return Err(error);
                }
            }
        }
        self.prune_absent_sources(configuration)?;

        let indexed = reports.iter().map(|report| report.indexed).sum();
        let skipped = reports.iter().map(|report| report.skipped).sum();
        let errors = reports.iter().map(|report| report.errors).sum();
        let _ = self
            .connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        let status = self.status()?;
        let resources = governor.finish();
        Ok(IndexReport {
            started_at_ms,
            completed_at_ms: now_ms(),
            duration_ms: duration_ms(started),
            indexed,
            skipped,
            errors,
            sources: reports,
            status,
            resources,
        })
    }

    pub fn query(&self, request: &QueryRequest) -> Result<QueryResponse, IndexerError> {
        let limit = request.limit.unwrap_or(usize::MAX);
        if limit == 0 {
            return Ok(QueryResponse {
                records: Vec::new(),
            });
        }
        let kinds = normalized_kinds(&request.kinds);
        let query = request.query.trim();
        let query_length = query.chars().count();
        let mut records = if query_length >= 3 {
            let mut matches = self.query_fts(query, &kinds, limit)?;
            if matches.is_empty() {
                matches = self.query_coarse_fuzzy(query, &kinds, limit)?;
                rank_records(&mut matches, query);
            }
            if matches.is_empty() {
                matches = self.query_path_fallback(query, &kinds, limit)?;
                rank_records(&mut matches, query);
            }
            matches
        } else if query_length > 0 {
            self.query_prefix(query, &kinds, limit)?
        } else {
            let mut matches = self.query_like(query, &kinds, limit)?;
            rank_records(&mut matches, query);
            matches
        };
        deduplicate_records(&mut records, limit);
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
            "SELECT COALESCE(SUM(count), 0) FROM source_status",
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
                "SELECT COALESCE(SUM(count), 0) FROM source_status WHERE kind = ?1",
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
            database_size_bytes: database_size_bytes(&self.database_path),
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
        max_entries: Option<usize>,
        governor: Arc<ResourceGovernor>,
        progress: &mut dyn FnMut(&IndexProgress) -> Result<(), IndexerError>,
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
            ScanContext {
                source,
                root: &root,
                root_text: &root_text,
                matcher,
                max_entries,
                generation,
                governor: Arc::clone(&governor),
            },
            progress,
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
        governor.check_memory_now()?;
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

    fn prune_absent_sources(
        &mut self,
        configuration: &IndexConfiguration,
    ) -> Result<(), IndexerError> {
        if configuration.prune_source_prefixes.is_empty() {
            return Ok(());
        }
        let transaction = self.connection.transaction()?;
        for prefix in &configuration.prune_source_prefixes {
            let active_ids = configuration
                .sources
                .iter()
                .filter(|source| source.id.starts_with(prefix))
                .map(|source| source.id.as_str())
                .collect::<Vec<_>>();
            let mut values = vec![SqlValue::Text(format!("{prefix}%"))];
            values.extend(active_ids.iter().map(|id| SqlValue::Text((*id).to_owned())));
            let selection = if active_ids.is_empty() {
                "source_id LIKE ?1".to_owned()
            } else {
                let placeholders = (2..=active_ids.len() + 1)
                    .map(|index| format!("?{index}"))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("source_id LIKE ?1 AND source_id NOT IN ({placeholders})")
            };
            transaction.execute(
                &format!("DELETE FROM records WHERE {selection}"),
                params_from_iter(values.iter()),
            )?;
            transaction.execute(
                &format!("DELETE FROM source_status WHERE {selection}"),
                params_from_iter(values.iter()),
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    fn query_fts(
        &self,
        query: &str,
        kinds: &[IndexKind],
        limit: usize,
    ) -> Result<Vec<IndexRecord>, IndexerError> {
        let strict = self
            .run_bounded_query(STRICT_FTS_BUDGET, || {
                self.query_strict_fts(query, kinds, limit)
            })?
            .unwrap_or_default();
        if !strict.is_empty() {
            return Ok(strict);
        }

        // The typo-tolerant expression ORs query trigrams. On a multi-million
        // record index, a no-match query containing common trigrams can touch
        // most of the FTS table. Keep that useful fallback, but never let it
        // hold the launcher behind an unbounded scan.
        Ok(self
            .run_bounded_query(FUZZY_FTS_BUDGET, || {
                self.query_fts_with_stats(query, kinds, limit)
            })?
            .map(|(records, _)| records)
            .unwrap_or_default())
    }

    fn query_strict_fts(
        &self,
        query: &str,
        kinds: &[IndexKind],
        limit: usize,
    ) -> rusqlite::Result<Vec<IndexRecord>> {
        let Some(fts_query) = strict_fts_query(query) else {
            return Ok(Vec::new());
        };
        let mut statement = self.connection.prepare(
            "SELECT r.path, r.name, r.parent, r.kind, r.modified_at_ms, r.size
             FROM records_fts
             JOIN records r ON r.rowid = records_fts.rowid
             WHERE records_fts MATCH ?1
               AND ((?2 = 1 AND r.kind = 'application')
                 OR (?3 = 1 AND r.kind = 'file')
                 OR (?4 = 1 AND r.kind = 'directory'))",
        )?;
        let flags = kind_flags(kinds);
        let rows =
            statement.query_map(params![fts_query, flags.0, flags.1, flags.2], row_to_record)?;
        collect_ranked_rows(rows, query, limit)
    }

    fn query_fts_with_stats(
        &self,
        query: &str,
        kinds: &[IndexKind],
        limit: usize,
    ) -> rusqlite::Result<(Vec<IndexRecord>, usize)> {
        let Some(fts_query) = fuzzy_fts_query(query) else {
            return Ok((Vec::new(), 0));
        };
        let mut statement = self.connection.prepare(
            "SELECT r.path, r.name, r.parent, r.kind, r.modified_at_ms, r.size
             FROM records_fts
             JOIN records r ON r.rowid = records_fts.rowid
             WHERE records_fts MATCH ?1
               AND ((?2 = 1 AND r.kind = 'application')
                 OR (?3 = 1 AND r.kind = 'file')
                 OR (?4 = 1 AND r.kind = 'directory'))",
        )?;
        let flags = kind_flags(kinds);
        let rows =
            statement.query_map(params![fts_query, flags.0, flags.1, flags.2], row_to_record)?;
        let mut records = Vec::with_capacity(limit.min(1_024));
        let mut candidates_evaluated = 0;
        let prune_at = limit.saturating_mul(16).max(1_024);
        for row in rows {
            let mut record = row?;
            candidates_evaluated += 1;
            if rank_record(&mut record, query) {
                records.push(record);
                if records.len() >= prune_at {
                    retain_best_ranked_records(&mut records, limit);
                }
            }
        }
        retain_best_ranked_records(&mut records, limit);
        Ok((records, candidates_evaluated))
    }

    fn query_prefix(
        &self,
        query: &str,
        kinds: &[IndexKind],
        limit: usize,
    ) -> Result<Vec<IndexRecord>, IndexerError> {
        let prefix = format!("{}%", escape_like(query));
        let mut records = Vec::with_capacity(limit.min(1_024));
        let mut statement = self.connection.prepare(
            "SELECT path, name, parent, kind, modified_at_ms, size
             FROM records
             WHERE kind = ?1
               AND name LIKE ?2 ESCAPE '\\' COLLATE NOCASE
             ORDER BY CASE WHEN name = ?3 COLLATE NOCASE THEN 0 ELSE 1 END,
                      length(name), name COLLATE NOCASE, path
             LIMIT ?4",
        )?;
        for kind in kinds {
            // This is an output page after SQL ranking, never a pre-ranking
            // alphabetic candidate slice. An exact name anywhere wins.
            let rows = statement.query_map(
                params![
                    kind.as_str(),
                    &prefix,
                    query,
                    i64::try_from(limit).unwrap_or(i64::MAX)
                ],
                row_to_record,
            )?;
            records.extend(collect_rows(rows)?);
        }
        for record in &mut records {
            record.score = if record.name.eq_ignore_ascii_case(query) {
                100_000
            } else {
                80_000 - i64::try_from(record.name.chars().count()).unwrap_or(i64::MAX)
            };
        }
        records.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
                .then_with(|| left.path.cmp(&right.path))
        });
        Ok(records)
    }

    fn query_like(
        &self,
        query: &str,
        kinds: &[IndexKind],
        limit: usize,
    ) -> Result<Vec<IndexRecord>, IndexerError> {
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
                i64::try_from(limit).unwrap_or(i64::MAX)
            ],
            |row| {
                let mut record = row_to_record(row)?;
                record.score = row.get(6)?;
                Ok(record)
            },
        )?;
        collect_rows(rows)
    }

    fn query_coarse_fuzzy(
        &self,
        query: &str,
        kinds: &[IndexKind],
        limit: usize,
    ) -> Result<Vec<IndexRecord>, IndexerError> {
        let mut seen = HashSet::new();
        let prefixes = query
            .to_lowercase()
            .chars()
            .filter(|character| character.is_alphanumeric())
            .filter(|character| seen.insert(*character))
            .take(MAX_COARSE_QUERY_CHARACTERS)
            .map(|character| format!("{character}%"))
            .collect::<Vec<_>>();
        if prefixes.is_empty() {
            return Ok(Vec::new());
        }
        let prefix_matches = prefixes
            .iter()
            .enumerate()
            .map(|(index, _)| {
                let parameter = index + 1;
                format!("name LIKE ?{parameter} COLLATE NOCASE")
            })
            .collect::<Vec<_>>()
            .join(" OR ");
        let application_parameter = prefixes.len() + 1;
        let file_parameter = application_parameter + 1;
        let directory_parameter = file_parameter + 1;
        let sql = format!(
            "SELECT path, name, parent, kind, modified_at_ms, size
             FROM records
             WHERE ({prefix_matches})
               AND ((?{application_parameter} = 1 AND kind = 'application')
                 OR (?{file_parameter} = 1 AND kind = 'file')
                 OR (?{directory_parameter} = 1 AND kind = 'directory'))"
        );
        let flags = kind_flags(kinds);
        let mut parameters = prefixes.into_iter().map(SqlValue::Text).collect::<Vec<_>>();
        parameters.extend([
            SqlValue::Integer(flags.0),
            SqlValue::Integer(flags.1),
            SqlValue::Integer(flags.2),
        ]);
        Ok(self
            .run_bounded_query(COARSE_FUZZY_BUDGET, || {
                let mut statement = self.connection.prepare(&sql)?;
                let rows =
                    statement.query_map(params_from_iter(parameters.iter()), row_to_record)?;
                collect_ranked_rows(rows, query, limit)
            })?
            .unwrap_or_default())
    }

    fn query_path_fallback(
        &self,
        query: &str,
        kinds: &[IndexKind],
        limit: usize,
    ) -> Result<Vec<IndexRecord>, IndexerError> {
        Ok(self
            .run_bounded_query(PATH_FALLBACK_BUDGET, || {
                let contains = format!("%{}%", escape_like(query));
                let flags = kind_flags(kinds);
                let mut statement = self.connection.prepare(
                    "SELECT path, name, parent, kind, modified_at_ms, size
                     FROM records
                     WHERE path LIKE ?1 ESCAPE '\\' COLLATE NOCASE
                       AND ((?2 = 1 AND kind = 'application')
                         OR (?3 = 1 AND kind = 'file')
                         OR (?4 = 1 AND kind = 'directory'))",
                )?;
                let rows = statement
                    .query_map(params![contains, flags.0, flags.1, flags.2], row_to_record)?;
                collect_ranked_rows(rows, query, limit)
            })?
            .unwrap_or_default())
    }

    fn run_bounded_query<T>(
        &self,
        budget: Duration,
        query: impl FnOnce() -> rusqlite::Result<T>,
    ) -> Result<Option<T>, IndexerError> {
        let deadline = Instant::now() + budget;
        self.connection
            .progress_handler(10_000, Some(move || Instant::now() >= deadline));
        let result = query();
        self.connection.progress_handler(0, None::<fn() -> bool>);
        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::SqliteFailure(failure, _))
                if failure.code == ErrorCode::OperationInterrupted =>
            {
                Ok(None)
            }
            Err(error) => Err(error.into()),
        }
    }
}

fn configure_database_resources(
    connection: &Connection,
    limits: &EffectiveResourceLimits,
) -> Result<(), IndexerError> {
    let cache_kib = i64::try_from(limits.sqlite_cache_kib).unwrap_or(i64::MAX);
    connection.pragma_update(None, "cache_size", -cache_kib)?;
    connection.pragma_update(None, "mmap_size", 0_i64)?;
    connection.execute_batch(
        "PRAGMA cache_spill=ON;
         PRAGMA temp_store=MEMORY;",
    )?;
    Ok(())
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
         INSERT INTO metadata(key, value) VALUES ('schema_version', 3)
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
         CREATE TRIGGER IF NOT EXISTS records_after_update AFTER UPDATE ON records
         WHEN old.name IS NOT new.name BEGIN
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
        schema_version = 3;
    }
    if schema_version == 2 {
        migrate_fts_update_trigger(connection)?;
        schema_version = 3;
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
             CREATE TRIGGER records_after_update AFTER UPDATE ON records
             WHEN old.name IS NOT new.name BEGIN
               INSERT INTO records_fts(records_fts, rowid, name)
               VALUES ('delete', old.rowid, old.name);
               INSERT INTO records_fts(rowid, name) VALUES (new.rowid, new.name);
             END;
             INSERT INTO records_fts(records_fts) VALUES ('rebuild');
             UPDATE metadata SET value = 3 WHERE key = 'schema_version';
             COMMIT;",
        )
    })?;
    Ok(())
}

fn migrate_fts_update_trigger(connection: &Connection) -> Result<(), IndexerError> {
    retry_database_busy(|| {
        connection.execute_batch(
            "BEGIN IMMEDIATE;
             DROP TRIGGER IF EXISTS records_after_update;
             CREATE TRIGGER records_after_update AFTER UPDATE ON records
             WHEN old.name IS NOT new.name BEGIN
               INSERT INTO records_fts(records_fts, rowid, name)
               VALUES ('delete', old.rowid, old.name);
               INSERT INTO records_fts(rowid, name) VALUES (new.rowid, new.name);
             END;
             UPDATE metadata SET value = 3 WHERE key = 'schema_version';
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

struct ScanContext<'a> {
    source: &'a IndexSource,
    root: &'a Path,
    root_text: &'a str,
    matcher: Arc<CustomIgnoreMatcher>,
    max_entries: Option<usize>,
    generation: i64,
    governor: Arc<ResourceGovernor>,
}

fn scan_and_store(
    transaction: &Transaction<'_>,
    context: ScanContext<'_>,
    progress: &mut dyn FnMut(&IndexProgress) -> Result<(), IndexerError>,
) -> Result<SourceReport, IndexerError> {
    let ScanContext {
        source,
        root,
        root_text,
        matcher,
        max_entries,
        generation,
        governor,
    } = context;
    let mut builder = WalkBuilder::new(root);
    builder
        // ignore 0.4.25 is pinned and holds at most one ReadDir per traversal
        // worker. ResourceGovernor takes the strictest thread, parallel-work,
        // logical-CPU, and open-directory ceiling before we reach this call.
        .threads(governor.effective().worker_threads)
        .hidden(!source.include_hidden)
        .follow_links(source.follow_symlinks)
        // A source is a filesystem boundary. Commander supplies one source
        // per mounted volume, which indexes all mounted files without walking
        // another volume twice through a mount point.
        .same_file_system(true)
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
    let (sender, receiver) =
        mpsc::sync_channel::<ScanMessage>(governor.effective().channel_capacity);
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
    emit_index_progress(&report, progress)?;

    std::thread::scope(|scope| -> Result<(), IndexerError> {
        let walker_sender = sender.clone();
        let walker_cancelled = Arc::clone(&cancelled);
        let walker_discovered = Arc::clone(&discovered);
        let walker_governor = Arc::clone(&governor);
        scope.spawn(move || {
            walker.run(|| {
                let sender = walker_sender.clone();
                let cancelled = Arc::clone(&walker_cancelled);
                let discovered = Arc::clone(&walker_discovered);
                let matcher = Arc::clone(&matcher);
                let governor = Arc::clone(&walker_governor);
                let kinds = kinds.clone();
                let root = root_owned.clone();
                Box::new(move |entry| {
                    if cancelled.load(Ordering::Relaxed) {
                        return WalkState::Quit;
                    }
                    if let Err(error) = governor.checkpoint() {
                        cancelled.store(true, Ordering::Relaxed);
                        let _ = sender.send(ScanMessage::Fatal(error));
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
                        if let Some(max_entries) = max_entries {
                            let next = discovered.fetch_add(1, Ordering::Relaxed) + 1;
                            if next > max_entries {
                                cancelled.store(true, Ordering::Relaxed);
                                let _ = sender.send(ScanMessage::LimitExceeded(max_entries));
                                return WalkState::Quit;
                            }
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
        let mut fatal_error = None;
        for message in receiver {
            match message {
                ScanMessage::Record(record) => {
                    if fatal_error.is_some() {
                        continue;
                    }
                    if let Err(error) = governor.checkpoint() {
                        cancelled.store(true, Ordering::Relaxed);
                        fatal_error = Some(error);
                        continue;
                    }
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
                ScanMessage::LimitExceeded(max_entries) => {
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
                ScanMessage::Fatal(error) => {
                    cancelled.store(true, Ordering::Relaxed);
                    if fatal_error.is_none() {
                        fatal_error = Some(error);
                    }
                }
            }
            let processed = report.indexed + report.skipped + report.errors;
            if processed > 0 && processed % 500 == 0 {
                emit_index_progress(&report, progress)?;
            }
        }
        if let Some(error) = fatal_error {
            return Err(error);
        }
        Ok(())
    })?;
    emit_index_progress(&report, progress)?;
    Ok(report)
}

fn emit_index_progress(
    report: &SourceReport,
    callback: &mut dyn FnMut(&IndexProgress) -> Result<(), IndexerError>,
) -> Result<(), IndexerError> {
    callback(&IndexProgress {
        source_id: report.source_id.clone(),
        root: report.root.clone(),
        processed: report.indexed + report.skipped + report.errors,
        indexed: report.indexed,
        skipped: report.skipped,
        errors: report.errors,
    })
}

enum ScanMessage {
    Record(CandidateRecord),
    Skipped,
    WalkError(String),
    LimitExceeded(usize),
    Fatal(IndexerError),
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
    let target_metadata = if file_type.is_symlink() {
        fs::metadata(path).ok()
    } else {
        None
    };
    let is_directory =
        file_type.is_dir() || target_metadata.as_ref().is_some_and(fs::Metadata::is_dir);
    let is_regular_file =
        file_type.is_file() || target_metadata.as_ref().is_some_and(fs::Metadata::is_file);
    let application = application_kind(path, is_directory, is_regular_file);
    let opaque_package = is_directory && opaque_package_directory(path);
    let dataless_directory = is_directory && metadata.as_ref().is_some_and(metadata_is_dataless);
    let skip_children = is_directory && (application || opaque_package || dataless_directory);
    let kind = if application && kinds.contains(&IndexKind::Application) {
        Some(IndexKind::Application)
    } else if is_directory && kinds.contains(&IndexKind::Directory) && !application {
        Some(IndexKind::Directory)
    } else if !is_directory && kinds.contains(&IndexKind::File) && !application {
        // A searchable file reference includes regular files, symbolic links,
        // sockets, FIFOs, and device nodes. Commander stores metadata only and
        // never opens these during indexing.
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
    if configuration.max_entries == Some(0) {
        return Err(IndexerError::new(
            "invalid_configuration",
            "maxEntries must be null/omitted for unlimited indexing or at least 1",
        ));
    }
    if configuration.prune_source_prefixes.len() > MAX_SOURCES {
        return Err(IndexerError::new(
            "invalid_configuration",
            format!("at most {MAX_SOURCES} source-prune prefixes are allowed"),
        ));
    }
    let mut prune_prefixes = HashSet::new();
    for prefix in &configuration.prune_source_prefixes {
        if prefix.trim().is_empty() || prefix.len() > 128 {
            return Err(IndexerError::new(
                "invalid_configuration",
                "source-prune prefixes must contain between 1 and 128 bytes",
            ));
        }
        if !prune_prefixes.insert(prefix.as_str()) {
            return Err(IndexerError::new(
                "invalid_configuration",
                format!("duplicate source-prune prefix: {prefix}"),
            ));
        }
    }
    validate_resource_limits(&configuration.resource_limits)?;
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

// Visit every matching row; retain only the best requested output page in
// memory. A small page must never become an arbitrary pre-ranking scan cap.
fn collect_ranked_rows(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<IndexRecord>>,
    query: &str,
    limit: usize,
) -> rusqlite::Result<Vec<IndexRecord>> {
    let mut records = Vec::with_capacity(limit.min(1_024));
    let prune_at = limit.saturating_mul(16).max(1_024);
    for row in rows {
        let mut record = row?;
        if rank_record(&mut record, query) {
            records.push(record);
            if records.len() >= prune_at {
                retain_best_ranked_records(&mut records, limit);
            }
        }
    }
    retain_best_ranked_records(&mut records, limit);
    Ok(records)
}

fn deduplicate_records(records: &mut Vec<IndexRecord>, limit: usize) {
    let mut seen = HashSet::new();
    records.retain(|record| seen.insert((record.path.clone(), record.kind)));
    records.truncate(limit);
}

fn rank_records(records: &mut Vec<IndexRecord>, query: &str) {
    if query.is_empty() {
        records.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.path.cmp(&right.path))
        });
        return;
    }
    records.retain_mut(|record| rank_record(record, query));
    sort_ranked_records(records);
}

fn rank_record(record: &mut IndexRecord, query: &str) -> bool {
    let name_score = fuzzy_text_score(query, &record.name);
    let parent_score = fuzzy_text_score(query, &record.parent).map(|score| score * 35 / 100);
    let Some(score) = name_score.into_iter().chain(parent_score).max() else {
        return false;
    };
    record.score = i64::try_from(score).unwrap_or(i64::MAX);
    true
}

fn retain_best_ranked_records(records: &mut Vec<IndexRecord>, limit: usize) {
    sort_ranked_records(records);
    records.truncate(limit);
}

fn sort_ranked_records(records: &mut [IndexRecord]) {
    records.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.path.cmp(&right.path))
    });
}

fn fuzzy_fts_query(query: &str) -> Option<String> {
    let characters: Vec<char> = query.to_lowercase().chars().collect();
    if characters.len() < 3 {
        return None;
    }
    let mut seen = HashSet::new();
    let terms = characters
        .windows(3)
        .map(|window| window.iter().collect::<String>())
        .filter(|term| seen.insert(term.clone()))
        .take(64)
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>();
    (!terms.is_empty()).then(|| terms.join(" OR "))
}

fn strict_fts_query(query: &str) -> Option<String> {
    let terms = query
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 3)
        .map(|term| format!("\"{}\"", term.to_lowercase().replace('"', "\"\"")))
        .collect::<Vec<_>>();
    (!terms.is_empty()).then(|| terms.join(" AND "))
}

fn database_size_bytes(path: &Path) -> u64 {
    ["", "-wal", "-shm"]
        .into_iter()
        .filter_map(|suffix| {
            let mut candidate = path.as_os_str().to_os_string();
            candidate.push(suffix);
            fs::metadata(PathBuf::from(candidate))
                .ok()
                .map(|item| item.len())
        })
        .sum()
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

fn default_query_limit() -> Option<usize> {
    Some(50)
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
            max_entries: Some(10_000),
            resource_limits: IndexResourceLimits::default(),
            prune_source_prefixes: Vec::new(),
        }
    }

    #[test]
    fn prunes_records_for_disconnected_sources_inside_the_requested_namespace() {
        let temp = TempDir::new().expect("tempdir");
        let boot = temp.path().join("boot");
        let volume = temp.path().join("volume");
        create_dir_all(&boot).expect("boot directory");
        create_dir_all(&volume).expect("volume directory");
        write(boot.join("boot.txt"), "boot").expect("boot file");
        write(volume.join("volume.txt"), "volume").expect("volume file");

        let mut first = configuration(&boot, vec![IndexKind::File]);
        first.sources = vec![
            IndexSource {
                id: "filesystem:/".to_owned(),
                root: boot.clone(),
                kinds: vec![IndexKind::File],
                respect_git_ignore: true,
                include_hidden: false,
                follow_symlinks: false,
                max_depth: None,
            },
            IndexSource {
                id: "filesystem:/Volumes/Work".to_owned(),
                root: volume,
                kinds: vec![IndexKind::File],
                respect_git_ignore: true,
                include_hidden: false,
                follow_symlinks: false,
                max_depth: None,
            },
        ];
        first.prune_source_prefixes = vec!["filesystem:".to_owned()];
        let mut database = database(&temp);
        database.index(&first).expect("initial index");

        let mut after_unmount = configuration(&boot, vec![IndexKind::File]);
        after_unmount.sources[0].id = "filesystem:/".to_owned();
        after_unmount.prune_source_prefixes = vec!["filesystem:".to_owned()];
        database
            .index(&after_unmount)
            .expect("reconcile mounted sources");

        let records = database
            .query(&QueryRequest {
                query: String::new(),
                kinds: vec![IndexKind::File],
                limit: Some(20),
            })
            .expect("query");
        assert_eq!(records.records.len(), 1);
        assert_eq!(records.records[0].name, "boot.txt");
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
        assert_eq!(migrated.status().expect("status").schema_version, 3);
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
                limit: Some(20),
            })
            .expect("query");
        assert_eq!(results.records.len(), 1);
        assert_eq!(results.records[0].name, "keep.txt");
    }

    #[test]
    fn version_two_fts_trigger_is_migrated_without_rebuilding_the_index() {
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
                "DROP TRIGGER records_after_update;
                 CREATE TRIGGER records_after_update AFTER UPDATE ON records BEGIN
                   INSERT INTO records_fts(records_fts, rowid, name)
                   VALUES ('delete', old.rowid, old.name);
                   INSERT INTO records_fts(rowid, name) VALUES (new.rowid, new.name);
                 END;
                 UPDATE metadata SET value = 2 WHERE key = 'schema_version';",
            )
            .expect("version two fixture");
        drop(legacy);

        let migrated = IndexDatabase::open(&database_path).expect("migrate index");
        assert_eq!(migrated.status().expect("status").schema_version, 3);
        let definition: String = migrated
            .connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name = 'records_after_update'",
                [],
                |row| row.get(0),
            )
            .expect("trigger definition");
        assert!(definition.contains("WHEN old.name IS NOT new.name"));
        let results = migrated
            .query(&QueryRequest {
                query: "keep".to_owned(),
                kinds: vec![IndexKind::File],
                limit: Some(20),
            })
            .expect("query");
        assert_eq!(results.records.len(), 1);
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
                limit: Some(20),
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
                limit: Some(20),
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
    fn deeply_nested_application_bundles_are_indexed_without_walking_their_contents() {
        let temp = TempDir::new().expect("tempdir");
        create_dir_all(temp.path().join("Managed/Store/Example.app/Contents/MacOS")).expect("app");
        write(
            temp.path()
                .join("Managed/Store/Example.app/Contents/MacOS/example"),
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
                limit: Some(20),
            })
            .expect("query apps");
        assert_eq!(applications.records.len(), 1);
        assert_eq!(applications.records[0].name, "Example");
        let files = database
            .query(&QueryRequest {
                query: "example".to_owned(),
                kinds: vec![IndexKind::File],
                limit: Some(20),
            })
            .expect("query files");
        assert!(files.records.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn indexes_executables_symlinks_and_special_file_references_without_traversing_them() {
        use std::os::unix::fs::symlink;
        use std::os::unix::net::UnixListener;

        let temp = TempDir::new().expect("tempdir");
        write(temp.path().join("raycast-start"), "#!/bin/sh\n").expect("executable script");
        create_dir_all(temp.path().join("target-folder")).expect("target directory");
        symlink("raycast-start", temp.path().join("script-link")).expect("file symlink");
        symlink("target-folder", temp.path().join("folder-link")).expect("directory symlink");
        symlink("missing-target", temp.path().join("broken-link")).expect("broken symlink");
        let socket_path = temp.path().join("commander.sock");
        let _socket = UnixListener::bind(&socket_path).expect("unix socket");

        let mut database = database(&temp);
        database
            .index(&configuration(
                temp.path(),
                vec![IndexKind::File, IndexKind::Directory],
            ))
            .expect("index references");
        let files = database
            .query(&QueryRequest {
                query: String::new(),
                kinds: vec![IndexKind::File],
                limit: Some(20),
            })
            .expect("files")
            .records;
        let file_names = files
            .iter()
            .map(|record| record.name.as_str())
            .collect::<HashSet<_>>();
        assert!(file_names.contains("raycast-start"));
        assert!(file_names.contains("script-link"));
        assert!(file_names.contains("broken-link"));
        assert!(file_names.contains("commander.sock"));

        let directories = database
            .query(&QueryRequest {
                query: String::new(),
                kinds: vec![IndexKind::Directory],
                limit: Some(20),
            })
            .expect("directories")
            .records;
        assert!(directories
            .iter()
            .any(|record| record.name == "folder-link"));
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
                limit: Some(20),
            })
            .expect("directories");
        assert_eq!(directories.records.len(), 1);
        assert_eq!(directories.records[0].name, "Media.photoslibrary");
        let files = database
            .query(&QueryRequest {
                query: "private".to_owned(),
                kinds: vec![IndexKind::File],
                limit: Some(20),
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
                limit: Some(20),
            })
            .expect("query files")
            .records
            .is_empty());
        assert!(!database
            .query(&QueryRequest {
                query: "folder".to_owned(),
                kinds: vec![IndexKind::Directory],
                limit: Some(20),
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
                limit: Some(20),
            })
            .expect("query")
            .records;
        assert_eq!(records[0].name, "invoice.txt");
    }

    #[test]
    fn every_catalogue_can_return_more_than_one_thousand_records_without_reindexing() {
        let temp = TempDir::new().expect("tempdir");
        let mut database = database(&temp);
        let transaction = database.connection.transaction().expect("transaction");
        for kind in [
            IndexKind::Application,
            IndexKind::File,
            IndexKind::Directory,
        ] {
            for index in 0..1_501 {
                let name = format!("catalogue-{index:04}");
                transaction
                    .execute(
                        "INSERT INTO records(source_id, path, name, parent, kind, generation)
                     VALUES ('catalogue-test', ?1, ?2, '/tmp', ?3, 1)",
                        params![
                            format!("/tmp/{}/{name}", kind.as_str()),
                            name,
                            kind.as_str()
                        ],
                    )
                    .expect("insert catalogue record");
            }
        }
        transaction.commit().expect("commit catalogue");
        let writes = database.connection.total_changes();
        for kind in [
            IndexKind::Application,
            IndexKind::File,
            IndexKind::Directory,
        ] {
            for limit in [None, Some(1_501)] {
                for query in ["", "catalogue", "ca"] {
                    let response = database
                        .query(&QueryRequest {
                            query: query.to_owned(),
                            kinds: vec![kind],
                            limit,
                        })
                        .expect("complete catalogue query");
                    assert_eq!(response.records.len(), 1_501, "{kind:?}: {query}");
                    assert!(response
                        .records
                        .iter()
                        .any(|record| record.name == "catalogue-1500"));
                }
            }
        }
        assert_eq!(
            database.connection.total_changes(),
            writes,
            "queries must not index or write"
        );
    }

    #[test]
    fn short_prefix_ranks_before_taking_the_output_page() {
        let temp = TempDir::new().expect("tempdir");
        let mut database = database(&temp);
        let transaction = database.connection.transaction().expect("transaction");
        for index in 0..1_501 {
            let name = format!("aa-long-name-{index:04}");
            transaction
                .execute(
                    "INSERT INTO records(source_id, path, name, parent, kind, generation)
                 VALUES ('prefix-test', ?1, ?2, '/tmp', 'file', 1)",
                    params![format!("/tmp/{name}"), name],
                )
                .expect("insert prefix noise");
        }
        transaction
            .execute(
                "INSERT INTO records(source_id, path, name, parent, kind, generation)
             VALUES ('prefix-test', '/tmp/az', 'az', '/tmp', 'file', 1)",
                [],
            )
            .expect("insert late best match");
        transaction.commit().expect("commit");
        let response = database
            .query(&QueryRequest {
                query: "a".to_owned(),
                kinds: vec![IndexKind::File],
                limit: Some(1),
            })
            .expect("prefix page");
        assert_eq!(response.records[0].name, "az");
    }

    #[test]
    fn query_limit_defaults_to_a_page_and_null_requests_all_results() {
        let default: QueryRequest =
            serde_json::from_value(serde_json::json!({"query": ""})).unwrap();
        let all: QueryRequest =
            serde_json::from_value(serde_json::json!({"query": "", "limit": null})).unwrap();
        assert_eq!(default.limit, Some(50));
        assert_eq!(all.limit, None);
    }

    #[test]
    fn multiword_query_finds_names_across_separators_with_the_strict_fts_path() {
        let temp = TempDir::new().expect("tempdir");
        create_dir_all(temp.path().join("Thingtime Recovery.app")).expect("exact application");
        write(temp.path().join("thingtime-notes.txt"), "noise").expect("thingtime noise");
        write(temp.path().join("recovery-notes.txt"), "noise").expect("recovery noise");
        let mut database = database(&temp);
        database
            .index(&configuration(
                temp.path(),
                vec![IndexKind::Application, IndexKind::File],
            ))
            .expect("index");

        let records = database
            .query(&QueryRequest {
                query: "thingtime recovery".to_owned(),
                kinds: vec![IndexKind::Application, IndexKind::File],
                limit: Some(20),
            })
            .expect("query")
            .records;

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].kind, IndexKind::Application);
        assert_eq!(records[0].name, "Thingtime Recovery");
    }

    #[test]
    fn strict_fts_query_requires_each_search_word() {
        assert_eq!(
            strict_fts_query("Thingtime recovery"),
            Some("\"thingtime\" AND \"recovery\"".to_owned())
        );
        assert_eq!(
            strict_fts_query("raycast-start"),
            Some("\"raycast\" AND \"start\"".to_owned())
        );
        assert_eq!(strict_fts_query("a !"), None);
    }

    #[test]
    fn broad_fuzzy_fts_can_be_interrupted_by_its_time_budget() {
        let temp = TempDir::new().expect("tempdir");
        let mut database = database(&temp);
        let transaction = database.connection.transaction().expect("transaction");
        for index in 0..5_000 {
            let name = if index % 2 == 0 {
                format!("thingtime-noise-{index}")
            } else {
                format!("recovery-noise-{index}")
            };
            transaction
                .execute(
                    "INSERT INTO records(source_id, path, name, parent, kind, generation)
                     VALUES ('budget-test', ?1, ?2, '/tmp', 'file', 1)",
                    params![format!("/tmp/{name}"), name],
                )
                .expect("insert noise record");
        }
        transaction.commit().expect("commit noise records");

        let result = database
            .run_bounded_query(Duration::ZERO, || {
                database.query_fts_with_stats(
                    "thingtime recovery totally nonexistent zephyr",
                    &[IndexKind::File],
                    20,
                )
            })
            .expect("bounded query");

        assert!(result.is_none());
    }

    #[test]
    fn mixed_kind_query_has_no_pre_ranking_candidate_cap() {
        let temp = TempDir::new().expect("tempdir");
        create_dir_all(temp.path().join("raycast-stop.app")).expect("exact application");
        for index in 0..64 {
            write(
                temp.path().join(format!("raycast-start-{index:02}.txt")),
                "noise",
            )
            .expect("raycast noise");
            write(temp.path().join(format!("stop-{index:02}.txt")), "noise").expect("stop noise");
        }
        let mut database = database(&temp);
        database
            .index(&configuration(
                temp.path(),
                vec![IndexKind::Application, IndexKind::File],
            ))
            .expect("index");

        let (records, candidates_evaluated) = database
            .query_fts_with_stats(
                "raycast stop",
                &[IndexKind::Application, IndexKind::File],
                1,
            )
            .expect("query");

        assert_eq!(candidates_evaluated, 129);
        assert_eq!(records[0].kind, IndexKind::Application);
        assert_eq!(records[0].name, "raycast-stop");
    }

    #[test]
    fn short_query_uses_the_indexed_name_prefix_path() {
        let temp = TempDir::new().expect("tempdir");
        write(temp.path().join("earth.txt"), "earth").expect("earth");
        write(temp.path().join("dream.txt"), "dream").expect("dream");
        let mut database = database(&temp);
        database
            .index(&configuration(temp.path(), vec![IndexKind::File]))
            .expect("index");

        let records = database
            .query(&QueryRequest {
                query: "ea".to_owned(),
                kinds: vec![IndexKind::File],
                limit: Some(20),
            })
            .expect("short prefix query")
            .records;

        assert_eq!(
            records.first().map(|record| record.name.as_str()),
            Some("earth.txt")
        );
        assert!(records.iter().all(|record| record.name.starts_with("ea")));
    }

    #[test]
    fn filesystem_query_uses_shared_typo_and_transposition_ranking() {
        let temp = TempDir::new().expect("tempdir");
        write(temp.path().join("raycast-start"), "script").expect("raycast script");
        write(temp.path().join("settings-notes.txt"), "notes").expect("settings notes");
        write(temp.path().join("note"), "note").expect("short note");
        let mut database = database(&temp);
        database
            .index(&configuration(temp.path(), vec![IndexKind::File]))
            .expect("index");

        let transposed = database
            .query(&QueryRequest {
                query: "raycsat".to_owned(),
                kinds: vec![IndexKind::File],
                limit: Some(20),
            })
            .expect("transposition query")
            .records;
        assert_eq!(transposed[0].name, "raycast-start");

        let omitted = database
            .query(&QueryRequest {
                query: "settngs".to_owned(),
                kinds: vec![IndexKind::File],
                limit: Some(20),
            })
            .expect("omission query")
            .records;
        assert_eq!(omitted[0].name, "settings-notes.txt");

        let short_substitution = database
            .query(&QueryRequest {
                query: "nite".to_owned(),
                kinds: vec![IndexKind::File],
                limit: Some(20),
            })
            .expect("short substitution query")
            .records;
        assert_eq!(short_substitution[0].name, "note");
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
                limit: Some(20),
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
        config.max_entries = Some(2);
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
    fn omitted_entry_cap_indexes_every_matching_record_and_reports_database_size() {
        let temp = TempDir::new().expect("tempdir");
        for name in ["one.txt", "two.txt", "three.txt"] {
            write(temp.path().join(name), name).expect("file");
        }
        let mut config = configuration(temp.path(), vec![IndexKind::File]);
        config.max_entries = None;
        let mut database = database(&temp);
        let report = database.index(&config).expect("unlimited index");

        assert_eq!(report.indexed, 3);
        assert_eq!(report.errors, 0);
        assert_eq!(report.status.total_records, 3);
        assert!(report.status.database_size_bytes > 0);
    }

    #[test]
    fn resource_limits_use_the_strictest_concurrency_ceiling_and_report_usage() {
        let temp = TempDir::new().expect("tempdir");
        for index in 0..256 {
            write(temp.path().join(format!("entry-{index}.txt")), "entry").expect("file");
        }
        let mut config = configuration(temp.path(), vec![IndexKind::File]);
        config.resource_limits = IndexResourceLimits {
            max_threads: 8,
            max_parallelism: 3,
            max_open_directories: 2,
            max_cpu_percent: 100,
            max_memory_mib: 128,
        };
        let report = database(&temp)
            .index(&config)
            .expect("resource-bounded index");

        assert_eq!(report.indexed, 256);
        assert_eq!(
            report.resources.effective.worker_threads,
            report.resources.effective.logical_cpu_count.min(2)
        );
        assert_eq!(report.resources.effective.max_open_directories, 2);
        assert!(report.resources.effective.channel_capacity <= 4_096);
        assert!(report.resources.average_cpu_percent <= 100);
        assert!(report.resources.memory_checks > 0);
    }

    #[test]
    fn memory_limit_failure_preserves_the_previous_searchable_snapshot() {
        let temp = TempDir::new().expect("tempdir");
        write(temp.path().join("before.txt"), "before").expect("initial file");
        let mut database = database(&temp);
        database
            .index(&configuration(temp.path(), vec![IndexKind::File]))
            .expect("initial index");
        write(temp.path().join("after.txt"), "after").expect("new file");

        let allocation = vec![1_u8; 64 * 1024 * 1024];
        std::hint::black_box(&allocation);
        let mut constrained = configuration(temp.path(), vec![IndexKind::File]);
        constrained.resource_limits.max_memory_mib = 32;
        let error = database
            .index(&constrained)
            .expect_err("resident memory cap must abort the scan");
        assert_eq!(error.code, "resource_limit");
        assert!(error.message.contains("previous index was preserved"));

        let records = database
            .query(&QueryRequest {
                query: String::new(),
                kinds: vec![IndexKind::File],
                limit: Some(20),
            })
            .expect("query preserved index")
            .records;
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].name, "before.txt");
    }

    #[test]
    fn legacy_json_configuration_receives_balanced_resource_defaults() {
        let parsed: IndexConfiguration = serde_json::from_value(serde_json::json!({
            "sources": [{
                "id": "documents",
                "root": "/tmp",
                "kinds": ["file"]
            }],
            "maxEntries": 1000
        }))
        .expect("legacy configuration");
        assert_eq!(parsed.resource_limits, IndexResourceLimits::default());
        assert_eq!(parsed.max_entries, Some(1_000));
        assert!(parsed.sources[0].include_hidden);
    }

    #[test]
    fn omitted_or_null_entry_cap_deserializes_as_unlimited() {
        for max_entries in [None, Some(serde_json::Value::Null)] {
            let mut value = serde_json::json!({
                "sources": [{
                    "id": "home",
                    "root": "/tmp",
                    "kinds": ["file"]
                }]
            });
            if let Some(max_entries) = max_entries {
                value["maxEntries"] = max_entries;
            }
            let parsed: IndexConfiguration =
                serde_json::from_value(value).expect("unlimited config");
            assert_eq!(parsed.max_entries, None);
            assert!(parsed.sources[0].include_hidden);
        }
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
