//! Live directory candidate pages. Names are sorted once per physical directory
//! stamp, then fetched by an indexed ordinal or name. No sync membership, FTS,
//! or file-content authority is created by this cache.
use super::*;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

const STAGING_PREFIX: &str = ".thingtime-upload-";

pub(super) fn initialize(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS inventory_live_directories(
            id INTEGER PRIMARY KEY, identity TEXT NOT NULL UNIQUE, version TEXT NOT NULL, epoch INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS inventory_live_names(
            directory INTEGER NOT NULL REFERENCES inventory_live_directories(id) ON DELETE CASCADE,
            name TEXT NOT NULL, remote_ordinal INTEGER, visible_ordinal INTEGER,
            ordinal INTEGER NOT NULL, staging INTEGER NOT NULL, PRIMARY KEY(directory,name)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS inventory_live_all ON inventory_live_names(directory,ordinal);
        CREATE INDEX IF NOT EXISTS inventory_live_remote ON inventory_live_names(directory,remote_ordinal);
        CREATE INDEX IF NOT EXISTS inventory_live_visible ON inventory_live_names(directory,visible_ordinal);
        CREATE INDEX IF NOT EXISTS inventory_live_staging ON inventory_live_names(directory,staging,name);
        UPDATE metadata SET value=2 WHERE key='inventory_schema_version' AND value=1;",
    )
}

pub(super) struct Listing<'a> {
    pub(super) root: &'a Path,
    pub(super) root_identity: &'a str,
    pub(super) parent: &'a str,
    pub(super) after: Option<&'a str>,
    pub(super) offset: Option<usize>,
    pub(super) hidden: Option<bool>,
    pub(super) expected_version: Option<&'a str>,
    pub(super) limit: usize,
}

pub(super) fn list(
    db: &mut Connection,
    request: Listing<'_>,
    limits: &IndexResourceLimits,
    cancelled: Arc<AtomicBool>,
) -> Result<Value, IndexerError> {
    let unavailable = || failure("directory_unavailable");
    if request.limit == 0
        || request.limit > 512
        || (!request.parent.is_empty() && !valid_path(request.parent))
        || (request.after.is_some() && request.offset.is_some())
    {
        return Err(failure("invalid_request"));
    }
    let open = || {
        let root = inventory::open_root(request.root)?;
        if identity(&root.metadata()?) != request.root_identity {
            return Err(unavailable());
        }
        let directory = if request.parent.is_empty() {
            root
        } else {
            open_path(&root, request.parent).map_err(|_| unavailable())?
        };
        if !directory.metadata()?.is_dir() {
            return Err(unavailable());
        }
        Ok(directory)
    };
    let directory = open()?;
    let metadata = directory.metadata()?;
    let before = stamp(&metadata);
    let mount = inventory::mount_identity(&directory);
    let can_reuse = mount.is_some() && inventory::has_precise_stamps(&directory);
    let physical = format!(
        "{}:{}",
        mount.as_deref().unwrap_or("unknown"),
        identity(&metadata)
    );
    let verify = || {
        let reopened = open()?;
        if stamp(&directory.metadata()?) != before
            || stamp(&reopened.metadata()?) != before
            || inventory::mount_identity(&reopened) != mount
        {
            return Err(unavailable());
        }
        if cancelled.load(Ordering::Relaxed) {
            return Err(failure("capture_cancelled"));
        }
        Ok(())
    };
    if request
        .expected_version
        .is_some_and(|version| version != before)
    {
        return Err(unavailable());
    }
    let previous = if let Some(cursor) = request.after {
        let (version, name): (String, String) =
            serde_json::from_str(cursor).map_err(|_| unavailable())?;
        if before != version || name.is_empty() || name.contains('/') {
            return Err(unavailable());
        }
        Some(name)
    } else {
        None
    };
    let offset = request.offset.unwrap_or(0);
    let epoch = db.query_row(
        "SELECT value FROM metadata WHERE key='inventory_cache_epoch'",
        [],
        |r| r.get::<_, i64>(0),
    )?;
    if !can_reuse || lookup(db, &physical, &before, epoch)?.is_none() {
        let governor = ResourceGovernor::new(limits)?;
        // Only TEMP is written while enumerating. A large directory never
        // holds the main database writer while traversing or pacing work.
        db.execute_batch("CREATE TEMP TABLE inventory_live_input(name TEXT PRIMARY KEY,staging INTEGER NOT NULL,visible INTEGER NOT NULL) WITHOUT ROWID;")?;
        {
            let tx = db.transaction()?;
            let mut insert =
                tx.prepare_cached("INSERT INTO temp.inventory_live_input VALUES(?1,?2,?3)")?;
            for child in rustix::fs::Dir::read_from(&directory).map_err(|_| unavailable())? {
                if cancelled.load(Ordering::Relaxed) {
                    return Err(failure("capture_cancelled"));
                }
                governor.checkpoint()?;
                let child = child.map_err(|_| unavailable())?;
                let name = child.file_name().to_str().map_err(|_| unavailable())?;
                if matches!(name, "." | "..") {
                    continue;
                }
                let staging = name.starts_with(STAGING_PREFIX);
                insert.execute(params![name, staging, !name.starts_with('.')])?;
            }
            drop(insert);
            tx.commit()?;
        }
        governor.check_memory_now()?;
        verify()?;
        if !can_reuse {
            // Coarse or unknown directory stamps cannot validate a prior name
            // snapshot. Answer from this request's TEMP enumeration only.
            let eligible = match request.hidden {
                None => "1",
                Some(true) => "NOT staging",
                Some(false) => "visible",
            };
            let sql = format!("SELECT name FROM temp.inventory_live_input WHERE {eligible} AND name>?1 ORDER BY name LIMIT ?2 OFFSET ?3");
            let mut statement = db.prepare_cached(&sql)?;
            let names = statement
                .query_map(
                    params![previous.as_deref().unwrap_or(""), request.limit + 1, offset],
                    |row| row.get::<_, String>(0),
                )?
                .collect::<Result<Vec<_>, _>>()?;
            let staging = if request.hidden.is_some() && offset == 0 && request.after.is_none() {
                let mut statement = db.prepare_cached("SELECT name FROM temp.inventory_live_input WHERE staging=1 ORDER BY name LIMIT 128")?;
                let rows = statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            } else {
                Vec::new()
            };
            verify()?;
            return page_value(names, staging, &before, offset, &request);
        }
        let cancel = cancelled.clone();
        db.progress_handler(2048, Some(move || cancel.load(Ordering::Relaxed)));
        let result = (|| -> Result<(), IndexerError> {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            // The mount epoch can advance while we build in TEMP. Do not
            // re-admit an older observation after the watcher has lost state.
            let current_epoch = tx.query_row(
                "SELECT value FROM metadata WHERE key='inventory_cache_epoch'",
                [],
                |r| r.get::<_, i64>(0),
            )?;
            if current_epoch != epoch {
                return Err(unavailable());
            }
            if lookup(&tx, &physical, &before, epoch)?.is_none() {
                tx.execute(
                    "DELETE FROM inventory_live_directories WHERE identity=?1",
                    [&physical],
                )?;
                tx.execute("INSERT INTO inventory_live_directories(identity,version,epoch) VALUES(?1,?2,?3)",params![physical,before,epoch])?;
                let id = tx.last_insert_rowid();
                tx.execute("INSERT INTO inventory_live_names(directory,name,ordinal,remote_ordinal,visible_ordinal,staging)
                    SELECT ?1,name,row_number() OVER w - 1,
                        CASE WHEN NOT staging THEN sum(NOT staging) OVER w - 1 END,
                        CASE WHEN visible THEN sum(visible) OVER w - 1 END,staging
                    FROM temp.inventory_live_input WINDOW w AS (ORDER BY name ROWS UNBOUNDED PRECEDING)",[id])?;
            }
            verify()?;
            tx.commit()?;
            Ok(())
        })();
        db.progress_handler(0, None::<fn() -> bool>);
        if cancelled.load(Ordering::Relaxed) {
            return Err(failure("capture_cancelled"));
        }
        result?;
    }
    let tx = db.transaction()?;
    let current_epoch = tx.query_row(
        "SELECT value FROM metadata WHERE key='inventory_cache_epoch'",
        [],
        |r| r.get::<_, i64>(0),
    )?;
    if current_epoch != epoch {
        return Err(unavailable());
    }
    let id = lookup(&tx, &physical, &before, epoch)?.ok_or_else(unavailable)?;
    let (ordinal, eligible) = match request.hidden {
        None => ("ordinal", "1"),
        Some(true) => ("remote_ordinal", "remote_ordinal IS NOT NULL"),
        Some(false) => ("visible_ordinal", "visible_ordinal IS NOT NULL"),
    };
    let names = if let Some(previous) = previous {
        let sql=format!("SELECT name FROM inventory_live_names WHERE directory=?1 AND name>?2 AND {eligible} ORDER BY name LIMIT ?3");
        let mut stmt = tx.prepare_cached(&sql)?;
        let rows = stmt
            .query_map(params![id, previous, request.limit + 1], |r| {
                r.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        let sql=format!("SELECT name FROM inventory_live_names WHERE directory=?1 AND {ordinal}>=?2 ORDER BY {ordinal} LIMIT ?3");
        let mut stmt = tx.prepare_cached(&sql)?;
        let rows = stmt
            .query_map(params![id, offset, request.limit + 1], |r| {
                r.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let staging = if request.hidden.is_some() && offset == 0 && request.after.is_none() {
        let mut stmt=tx.prepare_cached("SELECT name FROM inventory_live_names WHERE directory=?1 AND staging=1 ORDER BY name LIMIT 128")?;
        let rows = stmt
            .query_map([id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        Vec::new()
    };
    verify()?;
    page_value(names, staging, &before, offset, &request)
}

fn page_value(
    mut names: Vec<String>,
    staging: Vec<String>,
    before: &str,
    offset: usize,
    request: &Listing<'_>,
) -> Result<Value, IndexerError> {
    let more = names.len() > request.limit;
    if more {
        names.pop();
    }
    let next = if more {
        Some(
            serde_json::to_string(&(&before, names.last()))
                .map_err(|_| failure("directory_unavailable"))?,
        )
    } else {
        None
    };
    Ok(
        json!({"names":names,"nextAfter":next,"nextOffset":(more && request.after.is_none()).then_some(offset+names.len()),
        "directoryVersion":before,"stagingNames":staging}),
    )
}

fn lookup(
    db: &Connection,
    identity: &str,
    version: &str,
    epoch: i64,
) -> rusqlite::Result<Option<i64>> {
    db.query_row(
        "SELECT id FROM inventory_live_directories WHERE identity=?1 AND version=?2 AND epoch=?3",
        params![identity, version, epoch],
        |r| r.get(0),
    )
    .optional()
}
