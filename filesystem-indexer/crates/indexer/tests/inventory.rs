#![cfg(unix)]

use commander_indexer::{
    backup::inventory, IndexConfiguration, IndexDatabase, IndexerError, QueryRequest,
};
use serde_json::{json, Value};
use std::{
    fs,
    io::Cursor,
    os::unix::fs::{symlink, MetadataExt},
    path::{Path, PathBuf},
};

struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    db: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        #[cfg(not(target_os = "linux"))]
        let temp = tempfile::tempdir().unwrap();
        #[cfg(target_os = "linux")]
        let temp = tempfile::tempdir_in("/dev/shm").unwrap();
        let base = temp.path().canonicalize().unwrap();
        let root = base.join("grant");
        fs::create_dir(&root).unwrap();
        Self {
            _temp: temp,
            root,
            db: base.join("filesystem-index.sqlite3"),
        }
    }
    fn call(&self, command: Value) -> Result<Vec<Value>, IndexerError> {
        execute(&self.db, command)
    }
    fn root_operation(&self, op: &str, generation: &str) -> Value {
        let metadata = self.root.metadata().unwrap();
        let mut value = operation(op, generation);
        value["root"] = json!(self.root);
        value["rootIdentity"] = json!(format!("{}:{}", metadata.dev(), metadata.ino()));
        value
    }
    fn scan(&self, generation: &str, mode: &str) -> Value {
        let mut value = self.root_operation("scan", generation);
        value["mode"] = json!(mode);
        value["resourceFeedback"] = json!(true);
        value
    }
}
fn scope() -> Value {
    json!({"origin":"https://fixture.invalid","accountId":"test-account","deviceId":"test-device","rootId":"test-root"})
}
fn operation(name: &str, generation: &str) -> Value {
    json!({"version":1,"operation":name,"scope":scope(),"generation":generation})
}
fn execute(db: &Path, command: Value) -> Result<Vec<Value>, IndexerError> {
    let request = serde_json::to_vec(&command).unwrap();
    let mut output = Vec::new();
    inventory::serve(db, Cursor::new(request), &mut output)?;
    Ok(String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect())
}
fn one(fixture: &Fixture, command: Value) -> Value {
    fixture.call(command).unwrap().pop().unwrap()
}
fn status(fixture: &Fixture, generation: &str) -> Value {
    one(fixture, operation("status", generation))
}
fn assert_fails(fixture: &Fixture, command: Value, code: &str) {
    assert_eq!(fixture.call(command).unwrap_err().code, code);
}

#[test]
fn strict_membership_requires_seal_and_keeps_private_paths_out_of_search() {
    let f = Fixture::new();
    fs::create_dir(f.root.join("sub")).unwrap();
    fs::write(f.root.join("sub/private-hidden-item"), "hello").unwrap();
    symlink("/etc/passwd", f.root.join("opaque-link")).unwrap();
    let events = f.call(f.scan("strict-1", "strict")).unwrap();
    assert_eq!(events.last().unwrap()["coverage"], "prepared");
    assert_eq!(events.last().unwrap()["entryCount"], 3);
    assert_fails(&f, operation("page", "strict-1"), "generation_unavailable");
    let mut other = operation("status", "strict-1");
    other["scope"]["accountId"] = json!("other-account");
    assert_eq!(one(&f, other), Value::Null);
    assert_eq!(
        one(&f, f.root_operation("seal", "strict-1"))["coverage"],
        "sealed"
    );
    let mut request = operation("page", "strict-1");
    request["limit"] = json!(1);
    let first = one(&f, request.clone());
    assert_eq!(first["entries"][0]["path"], "opaque-link");
    assert_eq!(
        first["entries"][0]["symbolicLink"]["format"],
        "posix-symlink-v1"
    );
    assert_eq!(first["nextOffset"], 1);
    request["after"] = first["nextAfter"].clone();
    let second = one(&f, request);
    assert_eq!(second["entries"][0]["path"], "sub");
    let mut children = operation("page", "strict-1");
    children["parent"] = json!("sub");
    assert_eq!(
        one(&f, children)["entries"][0]["path"],
        "sub/private-hidden-item"
    );
    let db = IndexDatabase::open(&f.db).unwrap();
    let search = db
        .query(&QueryRequest {
            query: "private-hidden-item".into(),
            kinds: vec![],
            limit: Some(5),
        })
        .unwrap();
    assert!(search.records.is_empty());
}

#[test]
fn rejects_changed_subtree_symlink_replacement_and_duplicate_inode() {
    let f = Fixture::new();
    let sub = f.root.join("sub");
    fs::create_dir(&sub).unwrap();
    fs::write(sub.join("first"), "one").unwrap();
    f.call(f.scan("prepared", "strict")).unwrap();
    fs::write(sub.join("first"), "two different bytes").unwrap();
    assert_fails(&f, f.root_operation("seal", "prepared"), "source_changed");
    assert_eq!(status(&f, "prepared")["coverage"], "invalidated");
    f.call(f.scan("swap", "strict")).unwrap();
    let outside = f.root.parent().unwrap().join("outside");
    fs::rename(&sub, &outside).unwrap();
    symlink(&outside, &sub).unwrap();
    assert_fails(&f, f.root_operation("seal", "swap"), "source_changed");
    fs::remove_file(&sub).unwrap();
    fs::rename(&outside, &sub).unwrap();
    fs::hard_link(sub.join("first"), sub.join("duplicate")).unwrap();
    assert_fails(&f, f.scan("duplicate", "strict"), "duplicate_identity");
    let backup = one(&f, f.scan("positive-only", "backup"));
    assert_eq!(backup["coverage"], "provisional");
    assert_eq!(backup["entryCount"], 2);
    assert_eq!(backup["gapCount"], 1);
    assert_fails(
        &f,
        f.root_operation("seal", "positive-only"),
        "generation_unavailable",
    );
}

#[test]
fn private_strict_and_backup_paths_honor_configured_cpu_policy() {
    let fixture = Fixture::new();
    let cpu_percent = |events: Vec<Value>| {
        events
            .iter()
            .rev()
            .find(|event| event["event"] == "resources")
            .unwrap()["usage"]["effective"]["maxCpuPercent"]
            .as_u64()
            .unwrap()
    };
    for (index, (limits, expected)) in [
        (None, 15),
        (Some(json!({"maxThreads": 2})), 15),
        (Some(json!({"maxCpuPercent": 40})), 40),
    ]
    .into_iter()
    .enumerate()
    {
        let mut request = fixture.scan(&format!("strict-{index}"), "strict");
        if let Some(limits) = limits.clone() {
            request["resourceLimits"] = limits;
        }
        assert_eq!(cpu_percent(fixture.call(request).unwrap()), expected);

        let mut request = fixture.scan(&format!("backup-{index}"), "backup");
        let request_fields = request.as_object_mut().unwrap();
        request_fields.remove("operation");
        request_fields.remove("mode");
        if let Some(limits) = limits {
            request["resourceLimits"] = limits;
        }
        let mut output = Vec::new();
        commander_indexer::backup::serve_with_database(
            Cursor::new(serde_json::to_vec(&request).unwrap()),
            &mut output,
            Some(&fixture.db),
        )
        .unwrap();
        let events = serde_json::Deserializer::from_slice(&output)
            .into_iter::<Value>()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(cpu_percent(events), expected);
    }
}

#[test]
fn scoped_invalidation_fences_authority_and_cancellation_preserves_valid_hashes() {
    let f = Fixture::new();
    let file = f.root.join("mutable");
    fs::write(&file, vec![11u8; 32768]).unwrap();
    let measured = |events: Vec<Value>| {
        events
            .iter()
            .rev()
            .find(|v| v["event"] == "resources")
            .unwrap()["usage"]["scanBytes"]
            .as_u64()
            .unwrap()
    };
    assert_eq!(measured(f.call(f.scan("one", "strict")).unwrap()), 32768);
    assert_eq!(one(&f, operation("cancel", "one"))["coverage"], "cancelled");
    assert_eq!(measured(f.call(f.scan("two", "strict")).unwrap()), 0);
    fs::write(&file, vec![22u8; 32768]).unwrap();
    assert_eq!(measured(f.call(f.scan("three", "strict")).unwrap()), 32768);
    let other = f.root.parent().unwrap().join("unrelated");
    fs::create_dir(&other).unwrap();
    let mut second = f.scan("other", "strict");
    let meta = other.metadata().unwrap();
    second["root"] = json!(other);
    second["rootIdentity"] = json!(format!("{}:{}", meta.dev(), meta.ino()));
    second["scope"]["rootId"] = json!("other-root");
    f.call(second).unwrap();
    let lost = json!({"version":1,"operation":"invalidatePaths","paths":[file],"lostEvents":false});
    assert_eq!(one(&f, lost)["invalidatedScopes"], 1);
    assert_eq!(status(&f, "three")["coverage"], "invalidated");
    let mut other_status = operation("status", "other");
    other_status["scope"]["rootId"] = json!("other-root");
    assert_eq!(one(&f, other_status.clone())["coverage"], "prepared");
    let lost = json!({"version":1,"operation":"invalidatePaths","paths":[],"lostEvents":true});
    assert_eq!(one(&f, lost)["invalidatedScopes"], 2);
    assert_eq!(one(&f, other_status)["coverage"], "invalidated");
    assert_eq!(
        measured(f.call(f.scan("after-mount-gap", "strict")).unwrap()),
        32768
    );
}

#[test]
fn failed_backup_reopens_same_revision_sequence_without_false_absence() {
    let f = Fixture::new();
    fs::write(f.root.join("first"), "one").unwrap();
    let request = serde_json::to_vec(&f.scan("recover", "backup")).unwrap();
    struct BrokenPipe {
        bytes: Vec<u8>,
    }
    impl std::io::Write for BrokenPipe {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            if String::from_utf8_lossy(&self.bytes).contains("\"event\":\"entry\"") {
                return Err(std::io::ErrorKind::BrokenPipe.into());
            }
            Ok(())
        }
    }
    assert_eq!(
        inventory::serve(
            &f.db,
            Cursor::new(request),
            BrokenPipe { bytes: Vec::new() }
        )
        .unwrap_err()
        .code,
        "output_closed"
    );
    assert_eq!(status(&f, "recover")["revision"], 1);
    fs::write(f.root.join("second"), "two").unwrap();
    let complete = one(&f, f.scan("recover", "backup"));
    assert_eq!(complete["coverage"], "provisional");
    assert_eq!(complete["revision"], 2);
    let mut changes = operation("changes", "recover");
    changes["limit"] = json!(1);
    let first = one(&f, changes.clone());
    assert_eq!(first["changes"][0]["sequence"], 1);
    assert_eq!(first["hasMore"], true);
    changes["afterSequence"] = first["nextSequence"].clone();
    let second = one(&f, changes.clone());
    assert_eq!(second["changes"][0]["entry"]["path"], "second");
    assert_eq!(second["hasMore"], false);
    changes["afterSequence"] = json!(3);
    assert_fails(&f, changes, "invalid_request");
    let gaps = one(&f, operation("gaps", "recover"));
    assert_eq!(gaps["gaps"][0]["scope"], "root");
}

#[test]
fn sync_admission_is_shared_without_blocking_search() {
    use std::{
        io::{Error, ErrorKind, Write},
        sync::mpsc,
    };
    let f = Fixture::new();
    fs::write(f.root.join("file"), "small").unwrap();
    let unrelated = f.root.parent().unwrap().join("search-root");
    fs::create_dir(&unrelated).unwrap();
    fs::write(unrelated.join("catalogue-test"), "index this").unwrap();
    let config: IndexConfiguration = serde_json::from_value(
        json!({"sources":[{"id":"test-source","root":unrelated,"kinds":["file"]}]}),
    )
    .unwrap();
    struct Hold {
        ready: Option<mpsc::Sender<()>>,
        release: mpsc::Receiver<()>,
    }
    impl Write for Hold {
        fn write(&mut self, b: &[u8]) -> Result<usize, Error> {
            Ok(b.len())
        }
        fn flush(&mut self) -> Result<(), Error> {
            if let Some(ready) = self.ready.take() {
                ready.send(()).unwrap();
                self.release
                    .recv_timeout(std::time::Duration::from_secs(5))
                    .map_err(|_| ErrorKind::TimedOut)?;
            }
            Ok(())
        }
    }
    let (ready, wait) = mpsc::channel();
    let (release, held) = mpsc::channel();
    let first = serde_json::to_vec(&f.scan("running", "strict")).unwrap();
    std::thread::scope(|threads| {
        let db = &f.db;
        let worker = threads.spawn(move || {
            inventory::serve(
                db,
                Cursor::new(first),
                Hold {
                    ready: Some(ready),
                    release: held,
                },
            )
        });
        wait.recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        assert_fails(&f, f.scan("overlap", "backup"), "inventory_busy");
        let mut search = IndexDatabase::open(&f.db).unwrap();
        search.index(&config).unwrap();
        assert_eq!(
            search
                .query(&QueryRequest {
                    query: "catalogue-test".into(),
                    kinds: vec![],
                    limit: Some(5)
                })
                .unwrap()
                .records
                .len(),
            1
        );
        assert_eq!(status(&f, "running")["coverage"], "scanning");
        release.send(()).unwrap();
        worker.join().unwrap().unwrap();
    });
    assert_eq!(status(&f, "running")["coverage"], "prepared");
}

#[test]
fn photo_observation_is_scoped_and_never_returns_temporary_file_authority() {
    let f = Fixture::new();
    fs::write(f.root.join("original"), "photo-data").unwrap();
    let mut observe = f.root_operation("observe", "unused");
    observe["path"] = json!("original");
    observe["resourceIdentity"] = json!("logical-resource-id");
    observe["resourceRevision"] = json!("photokit-revision-a");
    observe["resourcePath"] = json!("photo.jpg");
    let native = one(&f, observe);
    assert_eq!(native["path"], "original");
    let mut cached = operation("photoObservation", "unused");
    cached["resourceIdentity"] = json!("logical-resource-id");
    cached["resourceRevision"] = json!("photokit-revision-a");
    let logical = one(&f, cached.clone());
    assert_eq!(logical["id"], "logical-resource-id");
    assert_eq!(logical["path"], "photo.jpg");
    assert_ne!(logical["version"], native["version"]);
    assert_eq!(logical["fingerprint"], native["fingerprint"]);
    let mut batch = operation("photoObservations", "unused");
    batch["resources"] = json!([
        {"resourceIdentity":"missing","resourceRevision":"photokit-revision-a"},
        {"resourceIdentity":"logical-resource-id","resourceRevision":"photokit-revision-a"},
        {"resourceIdentity":"logical-resource-id","resourceRevision":"older"}
    ]);
    assert_eq!(one(&f, batch), json!([null, logical, null]));
    let loss = json!({"version":1,"operation":"invalidatePaths","paths":[],"lostEvents":true});
    assert_eq!(one(&f, loss)["invalidatedScopes"], 0);
    assert_eq!(one(&f, cached.clone()), logical);
    let mut other = cached.clone();
    other["scope"]["accountId"] = json!("unrelated");
    assert_eq!(one(&f, other), Value::Null);
    cached["resourceRevision"] = json!("photokit-revision-b");
    assert_eq!(one(&f, cached), Value::Null);
}

#[test]
fn photo_capture_seals_only_exact_scoped_observations_and_pages_stably() {
    let f = Fixture::new();
    for (id, name, contents) in [
        ("first", "z-photo.jpg", "one"),
        ("second", "a-photo.jpg", "two"),
    ] {
        fs::write(f.root.join("original"), contents).unwrap();
        let mut observe = f.root_operation("observe", "unused");
        observe["path"] = json!("original");
        observe["resourceIdentity"] = json!(id);
        observe["resourceRevision"] = json!("v1");
        observe["resourcePath"] = json!(name);
        one(&f, observe);
    }
    let mut begin = operation("beginPhotoCapture", "photo-set");
    begin["resourceRevision"] = json!("snapshot-revision");
    assert_eq!(one(&f, begin.clone())["coverage"], "scanning");
    assert_eq!(one(&f, begin)["entryCount"], 0);
    let mut append = operation("appendPhotoCapture", "photo-set");
    append["resources"] = json!([{"resourceIdentity":"first","resourceRevision":"v1"},{"resourceIdentity":"second","resourceRevision":"missing"}]);
    assert_fails(&f, append.clone(), "observation_unavailable");
    assert_eq!(status(&f, "photo-set")["entryCount"], 0);
    append["resources"][1]["resourceRevision"] = json!("v1");
    assert_eq!(one(&f, append.clone())["entryCount"], 2);
    assert_eq!(one(&f, append)["entryCount"], 2);
    assert_fails(
        &f,
        operation("photoPage", "photo-set"),
        "generation_unavailable",
    );
    let mut gaps = operation("appendPhotoCloudGaps", "photo-set");
    gaps["paths"] = json!(["cloud-video.mov", "a-photo.jpg"]);
    assert_fails(&f, gaps.clone(), "collision");
    assert_eq!(status(&f, "photo-set")["gapCount"], 0);
    gaps["paths"] = json!(["cloud-video.mov"]);
    assert_eq!(one(&f, gaps)["gapCount"], 1);
    let mut seal = operation("sealPhotoCapture", "photo-set");
    seal["resourceRevision"] = json!("snapshot-revision");
    seal["totalEntries"] = json!(1);
    assert_fails(&f, seal.clone(), "generation_unavailable");
    seal["totalEntries"] = json!(2);
    assert_fails(&f, seal.clone(), "generation_unavailable");
    seal["totalGaps"] = json!(1);
    assert_eq!(one(&f, seal)["coverage"], "sealed");
    let page = one(&f, operation("gaps", "photo-set"));
    assert_eq!(page["gaps"][0]["reason"], "cloud-original");
    assert_eq!(page["gaps"][0]["path"], "cloud-video.mov");
    assert_eq!(page["gapCount"], 1);
    let mut page = operation("photoPage", "photo-set");
    page["limit"] = json!(1);
    let first = one(&f, page.clone());
    assert_eq!(first["entries"][0]["path"], "a-photo.jpg");
    assert_eq!(first["rootVersion"], "snapshot-revision");
    page["offset"] = first["nextOffset"].clone();
    assert_eq!(one(&f, page)["entries"][0]["path"], "z-photo.jpg");
    assert_eq!(
        one(&f, operation("discardPhotoCapture", "photo-set"))["coverage"],
        "invalidated"
    );
    assert_fails(
        &f,
        operation("photoPage", "photo-set"),
        "generation_unavailable",
    );
}

#[test]
fn sealed_page_rejects_replaced_root_and_bounded_page_never_truncates_inventory() {
    let f = Fixture::new();
    for index in 0..520 {
        fs::write(f.root.join(format!("entry-{index:04}")), []).unwrap();
    }
    f.call(f.scan("wide", "strict")).unwrap();
    assert_eq!(one(&f, f.root_operation("seal", "wide"))["entryCount"], 520);
    let mut page = operation("page", "wide");
    page["limit"] = json!(4096);
    let first = one(&f, page.clone());
    assert_eq!(first["entries"].as_array().unwrap().len(), 512);
    assert_eq!(first["status"]["generation"], "wide");
    assert_eq!(first["status"]["mode"], "strict");
    assert_eq!(first["status"]["coverage"], "sealed");
    assert_eq!(first["status"]["entryCount"], 520);
    assert_eq!(first["status"]["rootVersion"], first["rootVersion"]);
    page["offset"] = first["nextOffset"].clone();
    let last = one(&f, page);
    assert_eq!(last["entries"].as_array().unwrap().len(), 8);
    assert!(last["nextOffset"].is_null());
    let moved = f.root.parent().unwrap().join("moved");
    fs::rename(&f.root, &moved).unwrap();
    fs::create_dir(&f.root).unwrap();
    assert_fails(&f, operation("page", "wide"), "source_changed");
}

#[test]
fn root_ancestors_cannot_alias_an_authorized_inode() {
    let f = Fixture::new();
    let ancestor = f.root.parent().unwrap();
    let alias = ancestor.join("alias");
    symlink(ancestor, &alias).unwrap();
    let mut request = f.scan("aliased", "strict");
    request["root"] = json!(alias.join("grant"));
    assert_fails(&f, request, "source_changed");
}

#[test]
fn live_directory_offsets_use_one_sorted_snapshot_and_reject_a_stale_version() {
    let f = Fixture::new();
    for index in (0..1050).rev() {
        fs::write(f.root.join(format!("entry-{index:04}")), []).unwrap();
    }
    fs::write(f.root.join(".hidden"), []).unwrap();
    fs::write(f.root.join(".thingtime-upload-fixture"), []).unwrap();
    let mut query = f.root_operation("listChildren", "unused");
    query["hidden"] = json!(false);
    query["limit"] = json!(25);
    let first = one(&f, query.clone());
    assert_eq!(first["names"][0], "entry-0000");
    assert_eq!(first["nextOffset"], 25);
    assert_eq!(first["stagingNames"], json!([".thingtime-upload-fixture"]));
    query["offset"] = json!(1025);
    query["directoryVersion"] = first["directoryVersion"].clone();
    let late = one(&f, query.clone());
    assert_eq!(late["names"][0], "entry-1025");
    assert_eq!(late["names"][24], "entry-1049");
    assert!(late["nextOffset"].is_null());
    assert_eq!(late["stagingNames"], json!([]));
    let db = rusqlite::Connection::open(&f.db).unwrap();
    let cached: i64 = db
        .query_row(
            "SELECT count(*) FROM inventory_live_directories",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(cached, 1);
    fs::write(f.root.join("entry-1050"), []).unwrap();
    assert_fails(&f, query.clone(), "directory_unavailable");
    query.as_object_mut().unwrap().remove("directoryVersion");
    let updated = one(&f, query);
    assert_ne!(updated["directoryVersion"], first["directoryVersion"]);
    assert_eq!(updated["nextOffset"], 1050);
    let mut visible = f.root_operation("listChildren", "unused");
    visible["hidden"] = json!(true);
    visible["limit"] = json!(1);
    assert_eq!(one(&f, visible)["names"], json!([".hidden"]));
}

#[test]
fn capabilities_only_advertise_supported_strict_watchers() {
    let f = Fixture::new();
    let answer = one(&f, json!({"version":1,"operation":"capabilities"}));
    assert_eq!(
        answer,
        json!({"version":1,"strictCoverage":cfg!(any(target_os="macos",target_os="linux"))})
    );
    assert!(!f.db.exists());
}

#[test]
fn seal_reports_the_affected_relative_path_without_publishing() {
    let f = Fixture::new();
    fs::write(f.root.join("kept"), "before").unwrap();
    f.call(f.scan("pending", "strict")).unwrap();
    fs::write(f.root.join("kept"), "after").unwrap();
    let mut output = Vec::new();
    let command = serde_json::to_vec(&f.root_operation("seal", "pending")).unwrap();
    let error = inventory::serve(&f.db, Cursor::new(command), &mut output).unwrap_err();
    assert_eq!(error.code, "source_changed");
    let gap: Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(
        gap,
        json!({"event":"skipped","gap":{"path":"kept","reason":"changed","scope":"entry"}})
    );
    assert_fails(&f, operation("page", "pending"), "generation_unavailable");
}
