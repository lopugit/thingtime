#![cfg(unix)]
use commander_indexer::backup::{capture, Event, Request};
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::os::unix::fs::{symlink, MetadataExt};
use std::process::{Command, Stdio};
use tempfile::TempDir;

fn request(root: &std::path::Path, rules: &str) -> Request {
    let m = fs::metadata(root).unwrap();
    serde_json::from_value(
        json!({"version":1,"root":root,"rootIdentity":format!("{}:{}",m.dev(),m.ino()),
        "ignoreRules":rules,"resourceLimits":{"maxCpuPercent":100}}),
    )
    .unwrap()
}
fn events(root: &std::path::Path, rules: &str) -> Vec<Value> {
    let mut values = Vec::new();
    capture(request(root, rules), |e| {
        values.push(serde_json::to_value(e).unwrap());
        Ok(())
    })
    .unwrap();
    values
}

#[test]
fn shared_git_oracle_preserves_every_policy_decision() {
    let fixtures: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../remix/app/fileSync/syncIgnore.fixtures.json"
    ))
    .unwrap();
    let mut mismatches = Vec::new();
    for fixture in fixtures {
        let rules = fixture["rules"].as_str().unwrap();
        let matcher = commander_indexer::backup_ignore::BackupIgnoreRules::new(rules);
        for item in fixture["paths"].as_array().unwrap() {
            let path = item["path"].as_str().unwrap();
            let mut prefixes: Vec<_> = path
                .match_indices('/')
                .map(|(i, _)| (&path[..i], true))
                .collect();
            prefixes.push((path, item["kind"] == "folder"));
            let ignored = prefixes.iter().any(|(p, d)| matcher.ignores_entry(p, *d));
            if ignored != item["ignored"].as_bool().unwrap() {
                mismatches.push(format!("rules={rules:?}, path={path:?}, actual={ignored}"));
            }
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}

#[test]
fn streams_real_content_prunes_dependencies_and_does_not_import_gitignore() {
    let root = TempDir::new().unwrap();
    fs::create_dir_all(root.path().join("project/node_modules/deep")).unwrap();
    fs::write(
        root.path().join("project/node_modules/deep/omit"),
        "ignored",
    )
    .unwrap();
    fs::write(root.path().join(".gitignore"), "keep\n").unwrap();
    fs::write(root.path().join("keep"), "content").unwrap();
    fs::write(root.path().join("empty"), []).unwrap();
    symlink("/", root.path().join("outside")).unwrap();
    let values = events(root.path(), "node_modules/");
    assert_eq!(values.first().unwrap()["event"], "hello");
    assert_eq!(values.last().unwrap()["event"], "complete");
    let rows: Vec<_> = values.iter().filter_map(|v| v.get("entry")).collect();
    assert!(rows
        .iter()
        .any(|r| r["path"] == "keep" && r["fingerprint"]["algorithm"] == "sha256-parts-v1"));
    assert!(rows.iter().any(|r| r["path"] == "empty"
        && r["sha256"] == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
    assert!(!rows
        .iter()
        .any(|r| r["path"].as_str().unwrap().contains("node_modules")));
    assert!(values
        .iter()
        .any(|v| v["gap"]["path"] == "outside" && v["gap"]["reason"] == "symlink"));
}

#[test]
fn backup_includes_hidden_git_objects_worktree_metadata_and_pointer_files() {
    let root = TempDir::new().unwrap();
    let files = [
        "project/.git/objects/pack/saved.pack",
        "project/.git/worktrees/feature/HEAD",
        "project/.git/worktrees/feature/index",
        "project/.git/worktrees/feature/gitdir",
        "project/.git/refs/stash",
        "project/.git/logs/HEAD",
        "feature/.git",
        "feature/uncommitted.txt",
    ];
    for path in files {
        let destination = root.path().join(path);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(destination, format!("retained content: {path}")).unwrap();
    }
    fs::write(root.path().join(".gitignore"), "project/\nfeature/\n").unwrap();
    let values = events(root.path(), "node_modules/\n.venv/\n.cargo/git/");
    let rows: Vec<_> = values.iter().filter_map(|v| v.get("entry")).collect();
    assert!(rows.iter().any(|r| r["path"] == "project/.git"));
    for path in files {
        assert!(
            rows.iter()
                .any(|r| r["path"] == path && r["kind"] == "file"),
            "missing {path}"
        );
    }
    assert!(!values.iter().any(|v| v.get("gap").is_some()));
    assert_eq!(values.last().unwrap()["event"], "complete");
}

#[test]
fn refuses_replaced_root_and_sink_failure_without_completion() {
    let root = TempDir::new().unwrap();
    fs::write(root.path().join("one"), "data").unwrap();
    let mut changed = request(root.path(), "");
    changed.root_identity = "0:0".into();
    assert!(capture(changed, |_| Ok(())).is_err());
    let mut complete = false;
    assert!(capture(request(root.path(), ""), |event| {
        if matches!(event, Event::Complete) {
            complete = true;
        }
        if matches!(event, Event::Entry { .. }) {
            return Err(commander_indexer::IndexerError::new("test_sink", "closed"));
        }
        Ok(())
    })
    .is_err());
    assert!(!complete);
}

#[test]
fn cli_stream_finishes_without_database_or_path_in_arguments() {
    let root = TempDir::new().unwrap();
    fs::write(root.path().join("one"), "hello").unwrap();
    let m = fs::metadata(root.path()).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_commander-indexer"))
        .arg("backup")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    writeln!(
        child.stdin.take().unwrap(),
        "{}",
        json!({"version":1,"root":root.path(),"rootIdentity":format!("{}:{}",m.dev(),m.ino())})
    )
    .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let rows: Vec<Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(rows.last().unwrap()["event"], "complete");
    assert_eq!(rows[1]["entry"]["path"], "one");
}

#[test]
fn streaming_opt_in_preserves_legacy_hello_and_suppresses_aliases() {
    let root = TempDir::new().unwrap();
    fs::write(root.path().join("Upper"), "first").unwrap();
    fs::write(root.path().join("upper"), "second").unwrap();
    let legacy = events(root.path(), "");
    assert!(legacy[0].get("streaming").is_none());
    let mut request = request(root.path(), "");
    request.streaming = true;
    let mut values = Vec::new();
    capture(request, |e| {
        values.push(serde_json::to_value(e).unwrap());
        Ok(())
    })
    .unwrap();
    assert_eq!(values[0]["streaming"], true);
    if fs::read_dir(root.path()).unwrap().count() == 2 {
        assert!(!values.iter().any(|v| v.get("entry").is_some()));
        assert!(values.iter().any(|v| v["gap"]["reason"] == "collision"));
    }
}

#[test]
fn streaming_flushes_first_entry_before_completion() {
    #[derive(Default)]
    struct Output {
        bytes: Vec<u8>,
        flushes: Vec<Vec<u8>>,
    }
    impl Write for Output {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.flushes.push(self.bytes.clone());
            Ok(())
        }
    }
    let root = TempDir::new().unwrap();
    fs::write(root.path().join("first"), "content").unwrap();
    let metadata = fs::metadata(root.path()).unwrap();
    let line = format!(
        "{}\n",
        json!({"version":1,"streaming":true,"root":root.path(),"rootIdentity":format!("{}:{}",metadata.dev(),metadata.ino())})
    );
    let mut output = Output::default();
    commander_indexer::backup::serve(std::io::Cursor::new(line), &mut output).unwrap();
    assert!(output.flushes.iter().any(|bytes| {
        let text = std::str::from_utf8(bytes).unwrap();
        text.contains("\"event\":\"entry\"") && !text.contains("\"event\":\"complete\"")
    }));
}

#[test]
fn streaming_watches_new_paths_and_backlog_updates_until_acknowledged_stop() {
    use std::io::BufRead;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    struct Running(std::process::Child);
    impl Drop for Running {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let root = TempDir::new().unwrap();
    fs::write(root.path().join("original"), "one").unwrap();
    let m = fs::metadata(root.path()).unwrap();
    let mut child = Running(
        Command::new(env!("CARGO_BIN_EXE_commander-indexer"))
            .arg("backup")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let mut input = child.0.stdin.take().unwrap();
    let output = child.0.stdout.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in std::io::BufReader::new(output).lines() {
            let Ok(line) = line else {
                break;
            };
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                break;
            };
            if sender.send(event).is_err() {
                break;
            }
        }
    });
    writeln!(input, "{}", json!({"version":1,"streaming":true,"root":root.path(),"rootIdentity":format!("{}:{}",m.dev(),m.ino()),"ignoreRules":"ignored/","excludedPaths":["secret"],"resourceLimits":{"maxCpuPercent":100}})).unwrap();
    let mut sequence = 0;
    loop {
        let event = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        if event["event"] == "entry" || event["event"] == "skipped" {
            sequence += 1;
        }
        if event["event"] == "indexed" {
            break;
        }
    }
    let old_sequence = sequence;
    // These are created after the walk ended, while a transfer backlog could
    // still be active. The same subscription must discover and reobserve them.
    fs::create_dir(root.path().join("new-folder")).unwrap();
    fs::write(root.path().join("new-folder/new-file"), "new content").unwrap();
    fs::write(root.path().join("original"), "updated during backlog").unwrap();
    fs::create_dir(root.path().join("ignored")).unwrap();
    fs::write(root.path().join("ignored/hidden"), "ignored").unwrap();
    fs::write(root.path().join("secret"), "excluded").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut new_file = false;
    let mut updated = false;
    while Instant::now() < deadline && !(new_file && updated) {
        let event = receiver.recv_timeout(Duration::from_millis(500)).unwrap();
        if event["event"] == "entry" || event["event"] == "skipped" {
            sequence += 1;
        }
        if let Some(entry) = event.get("entry") {
            assert!(!entry["path"].as_str().unwrap().starts_with("ignored"));
            assert_ne!(entry["path"], "secret");
            new_file |= entry["path"] == "new-folder/new-file";
            updated |= entry["path"] == "original" && entry["size"] == 22;
        }
    }
    assert!(new_file && updated);
    // A stale consumer watermark cannot close the watcher.
    writeln!(
        input,
        "{}",
        json!({"event":"stop","afterSequence":old_sequence})
    )
    .unwrap();
    loop {
        let event = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_ne!(event["event"], "complete");
        if event["event"] == "entry" || event["event"] == "skipped" {
            sequence += 1;
        }
        if event["event"] == "indexed" {
            break;
        }
    }
    writeln!(
        input,
        "{}",
        json!({"event":"stop","afterSequence":sequence})
    )
    .unwrap();
    loop {
        let event = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        if event["event"] == "complete" {
            break;
        }
    }
    drop(input);
    assert!(child.0.wait().unwrap().success());
    reader.join().unwrap();
}

#[test]
fn task_owned_backup_reports_actual_worker_ceiling_and_fractional_cpu_measurement() {
    let root = TempDir::new().unwrap();
    fs::write(root.path().join("payload"), vec![7u8; 1024 * 1024]).unwrap();
    let mut request = request(root.path(), "");
    request.resource_feedback = true;
    request.cpu_budget_shares = 3;
    request.resource_limits.max_threads = 1;
    request.resource_limits.max_parallelism = 1;
    request.resource_limits.max_cpu_percent = 1;
    let mut resources = Vec::new();
    capture(request, |event| {
        if let Event::Resources { usage } = event {
            resources.push(usage);
        }
        Ok(())
    })
    .unwrap();
    let usage = resources.last().expect("requested measurement missing");
    assert_eq!(usage.effective.worker_threads, 1);
    assert_eq!(usage.active_worker_limit, 1);
    assert!(usage.cpu_measurement_available);
    assert!(usage.cpu_time_nanoseconds > 0);
    assert!(usage.wall_time_nanoseconds > 0);
    let measured = usage.cpu_time_nanoseconds as f64
        / usage.wall_time_nanoseconds as f64
        / usage.effective.logical_cpu_count as f64
        * 100.0;
    assert!(
        measured <= 0.4,
        "task index CPU exceeded its one-third allocation: {measured}"
    );
}
