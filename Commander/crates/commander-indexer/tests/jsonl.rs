use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use tempfile::TempDir;

#[test]
fn service_processes_correlated_requests_and_survives_invalid_json() {
    let temp = TempDir::new().expect("tempdir");
    let mut child = Command::new(env!("CARGO_BIN_EXE_commander-indexer"))
        .args([
            "serve",
            "--database",
            temp.path().join("index.sqlite3").to_str().expect("path"),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn indexer");
    let mut stdin = child.stdin.take().expect("stdin");
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout"));

    writeln!(stdin, "{{not-json").expect("invalid request");
    writeln!(
        stdin,
        "{}",
        json!({ "id": "status-1", "operation": "status" })
    )
    .expect("status request");
    stdin.flush().expect("flush");

    let mut first = String::new();
    stdout.read_line(&mut first).expect("first response");
    let first: Value = serde_json::from_str(&first).expect("first JSON");
    assert_eq!(first["ok"], false);
    assert_eq!(first["error"]["code"], "invalid_request");

    let mut second = String::new();
    stdout.read_line(&mut second).expect("second response");
    let second: Value = serde_json::from_str(&second).expect("second JSON");
    assert_eq!(second["id"], "status-1");
    assert_eq!(second["ok"], true);
    assert_eq!(second["result"]["schemaVersion"], 2);

    drop(stdin);
    assert!(child.wait().expect("wait").success());
}
