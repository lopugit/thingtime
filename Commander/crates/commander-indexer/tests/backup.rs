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
        assert!(rows.iter().any(|r| r["path"] == path && r["kind"] == "file"), "missing {path}");
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
