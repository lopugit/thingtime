//! PhotoKit's native host authorizes resource identifiers and library revision.
//! The Rust store seals only the corresponding scoped logical observations;
//! temporary original paths and inodes are never persisted as photo membership.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ResourceKey {
    pub(super) resource_identity: String,
    pub(super) resource_revision: String,
}

pub(super) fn lookup(
    db: &mut Connection,
    scope: &Scope,
    resources: &[ResourceKey],
) -> Result<Vec<Option<Value>>, IndexerError> {
    if resources.len() > 128
        || resources
            .iter()
            .any(|key| !valid_label(&key.resource_identity) || !valid_label(&key.resource_revision))
    {
        return Err(failure("invalid_request"));
    }
    let tx = db.transaction()?;
    let Some(scope_id) = scope.lookup(&tx)? else {
        return Ok(vec![None; resources.len()]);
    };
    let mut query=tx.prepare_cached("SELECT p.data FROM inventory_photo_observations p JOIN inventory_scopes s ON p.scope=s.id
        WHERE p.scope=?1 AND p.resource_id=?2 AND p.resource_revision=?3 AND p.watcher_cursor=s.watcher_cursor")?;
    resources
        .iter()
        .map(|key| {
            let row = query
                .query_row(
                    params![scope_id, key.resource_identity, key.resource_revision],
                    |r| r.get::<_, String>(0),
                )
                .optional()?;
            row.map(|value| serde_json::from_str(&value))
                .transpose()
                .map_err(|_| failure("inventory_unavailable"))
        })
        .collect()
}

pub(super) fn begin(
    db: &mut Connection,
    scope: &Scope,
    generation: &str,
    revision: &str,
) -> Result<(), IndexerError> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let scope_id = scope.ensure(&tx)?;
    if let Some(old) = status(&tx, scope, Some(generation))? {
        if old.mode == "photo"
            && old.root_stamp == revision
            && matches!(old.coverage.as_str(), "scanning" | "sealed")
        {
            return Ok(());
        }
        return Err(failure("generation_exists"));
    }
    tx.execute("INSERT INTO inventory_generations(scope,generation,mode,coverage,root,root_identity,root_stamp,watcher_cursor,created_ms,excludes)
        SELECT id,?2,'photo','scanning','','',?3,watcher_cursor,?4,'[]' FROM inventory_scopes WHERE id=?1",params![scope_id,generation,revision,now_ms()])?;
    tx.commit()?;
    Ok(())
}

pub(super) fn append(
    db: &mut Connection,
    current: &Status,
    resources: &[ResourceKey],
) -> Result<(), IndexerError> {
    if current.mode != "photo"
        || current.coverage != "scanning"
        || resources.len() > PAGE_LIMIT
        || resources
            .iter()
            .any(|key| !valid_label(&key.resource_identity) || !valid_label(&key.resource_revision))
    {
        return Err(failure("invalid_request"));
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if !scanning(&tx, current.id)? {
        return Err(failure("generation_unavailable"));
    }
    let mut added = 0;
    for resource in resources {
        let row=tx.query_row("SELECT p.data FROM inventory_photo_observations p JOIN inventory_generations g ON g.scope=p.scope
            WHERE g.id=?1 AND p.resource_id=?2 AND p.resource_revision=?3 AND p.watcher_cursor=g.watcher_cursor",
            params![current.id,resource.resource_identity,resource.resource_revision],|r|r.get::<_,String>(0)).optional()?.ok_or_else(||failure("observation_unavailable"))?;
        let entry: Value =
            serde_json::from_str(&row).map_err(|_| failure("inventory_unavailable"))?;
        let path = entry["path"]
            .as_str()
            .filter(|value| valid_path(value))
            .ok_or_else(|| failure("inventory_unavailable"))?;
        let version = entry["version"]
            .as_str()
            .ok_or_else(|| failure("inventory_unavailable"))?;
        let existing = tx
            .query_row(
                "SELECT version,identity FROM inventory_entries WHERE generation=?1 AND path=?2",
                params![current.id, path],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?;
        if let Some((old, identity)) = existing {
            if old == version && identity == resource.resource_identity {
                continue;
            }
            return Err(failure("collision"));
        }
        if tx.execute(
            "INSERT INTO inventory_identities VALUES(?1,?2) ON CONFLICT DO NOTHING",
            params![current.id, resource.resource_identity],
        )? == 0
        {
            return Err(failure("duplicate_identity"));
        }
        if tx.execute(
            "INSERT INTO inventory_names VALUES(?1,?2) ON CONFLICT DO NOTHING",
            params![current.id, key(path)],
        )? == 0
        {
            return Err(failure("collision"));
        }
        let parent = path.rsplit_once('/').map_or("", |(parent, _)| parent);
        tx.execute("INSERT INTO inventory_entries(generation,path,parent,version,identity,data) VALUES(?1,?2,?3,?4,?5,?6)",params![current.id,path,parent,version,resource.resource_identity,row])?;
        added += 1;
    }
    tx.execute(
        "UPDATE inventory_generations SET entry_count=entry_count+?2 WHERE id=?1",
        params![current.id, added],
    )?;
    tx.commit()?;
    Ok(())
}

/// PhotoKit reports only the explicit network-required result as a cloud gap.
pub(super) fn append_cloud_gaps(
    db: &mut Connection,
    current: &Status,
    paths: &[PathBuf],
) -> Result<(), IndexerError> {
    if current.mode != "photo" || current.coverage != "scanning" || paths.len() > 128 {
        return Err(failure("invalid_request"));
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if !scanning(&tx, current.id)? {
        return Err(failure("generation_unavailable"));
    }
    for path in paths {
        let path = path
            .to_str()
            .filter(|path| valid_path(path) && !path.contains('/'))
            .ok_or_else(|| failure("invalid_request"))?;
        // Canonical name protection also refuses a gap colliding with an entry.
        if tx.execute(
            "INSERT INTO inventory_names VALUES(?1,?2) ON CONFLICT DO NOTHING",
            params![current.id, key(path)],
        )? == 0
        {
            return Err(failure("collision"));
        }
        tx.execute(
            "INSERT INTO inventory_gaps(generation,ordinal,path,reason,coverage)
             SELECT id,gap_count,?2,'cloud-original','entry' FROM inventory_generations WHERE id=?1",
            params![current.id, path],
        )?;
        tx.execute(
            "UPDATE inventory_generations SET gap_count=gap_count+1 WHERE id=?1",
            [current.id],
        )?;
    }
    tx.commit()?;
    Ok(())
}
