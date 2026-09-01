use serde_json::{json, Value};
use std::fs::{create_dir, write};
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
    let fixture_root = temp.path().join("fixture");
    create_dir(&fixture_root).expect("fixture root");
    write(fixture_root.join("resource.txt"), "resource").expect("fixture file");

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
    assert_eq!(second["result"]["schemaVersion"], 3);

    writeln!(
        stdin,
        "{}",
        json!({
            "id": "index-1",
            "operation": "index",
            "configuration": {
                "sources": [{
                    "id": "fixture",
                    "root": fixture_root,
                    "kinds": ["file"]
                }],
                "maxEntries": 1000,
                "resourceLimits": {
                    "maxThreads": 8,
                    "maxParallelism": 4,
                    "maxOpenDirectories": 1,
                    "maxCpuPercent": 100,
                    "maxMemoryMiB": 128
                }
            }
        })
    )
    .expect("index request");
    stdin.flush().expect("flush index");
    let mut progress_events = Vec::new();
    let third = loop {
        let mut line = String::new();
        stdout.read_line(&mut line).expect("index response");
        let value: Value = serde_json::from_str(&line).expect("index JSON");
        if value["event"] == "progress" {
            progress_events.push(value);
        } else {
            break value;
        }
    };
    assert!(!progress_events.is_empty());
    assert_eq!(progress_events[0]["id"], "index-1");
    assert_eq!(progress_events[0]["progress"]["sourceId"], "fixture");
    assert_eq!(progress_events.last().unwrap()["progress"]["processed"], 1);
    assert_eq!(third["id"], "index-1");
    assert_eq!(third["ok"], true);
    assert_eq!(third["result"]["indexed"], 1);
    assert_eq!(
        third["result"]["resources"]["effective"]["workerThreads"],
        1
    );
    assert_eq!(
        third["result"]["resources"]["effective"]["maxMemoryMiB"],
        128
    );

    drop(stdin);
    assert!(child.wait().expect("wait").success());
}
