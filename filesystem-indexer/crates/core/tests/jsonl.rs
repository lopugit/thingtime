use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

fn run_json_lines(lines: &[Value]) -> Vec<Value> {
    run_raw_lines(
        &lines
            .iter()
            .map(|line| serde_json::to_string(line).expect("serialize request"))
            .collect::<Vec<_>>(),
    )
}

fn run_raw_lines(lines: &[String]) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_commander-search"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn commander-search");

    {
        let mut stdin = child.stdin.take().expect("child stdin");
        for line in lines {
            writeln!(stdin, "{line}").expect("write request line");
        }
    }

    let output = child.wait_with_output().expect("wait for commander-search");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    String::from_utf8(output.stdout)
        .expect("utf8 output")
        .lines()
        .map(|line| serde_json::from_str(line).expect("response JSON"))
        .collect()
}

fn settings_request() -> Value {
    json!({
        "query": "settings",
        "items": [
            {
                "id": "clipboard",
                "title": "Clipboard History",
                "kind": "builtin"
            },
            {
                "id": "settings",
                "title": "Settings",
                "subtitle": "Commander Settings",
                "kind": "builtin",
                "favourite": true,
                "actions": [{ "id": "open", "title": "Open", "shortcut": "Enter" }]
            }
        ]
    })
}

#[test]
fn binary_accepts_a_request_and_returns_flattened_hits() {
    let responses = run_json_lines(&[settings_request()]);

    assert_eq!(responses.len(), 1);
    assert_eq!(responses[0]["hits"].as_array().expect("hits").len(), 1);
    assert_eq!(responses[0]["hits"][0]["id"], "settings");
    assert_eq!(responses[0]["hits"][0]["title"], "Settings");
    assert!(responses[0]["hits"][0]["score"].as_u64().is_some());
    assert!(responses[0]["hits"][0].get("item").is_none());
}

#[test]
fn binary_processes_multiple_requests_in_order() {
    let mut second = settings_request();
    second["query"] = json!("clip");

    let responses = run_json_lines(&[settings_request(), second]);

    assert_eq!(responses.len(), 2);
    assert_eq!(responses[0]["hits"][0]["id"], "settings");
    assert_eq!(responses[1]["hits"][0]["id"], "clipboard");
}

#[test]
fn binary_flushes_each_response_before_stdin_closes() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_commander-search"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn commander-search");
    let mut stdin = child.stdin.take().expect("child stdin");
    let stdout = child.stdout.take().expect("child stdout");
    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut response = String::new();
        let result = BufReader::new(stdout).read_line(&mut response);
        sender.send((result, response)).expect("send response");
    });

    serde_json::to_writer(&mut stdin, &settings_request()).expect("write request");
    writeln!(stdin).expect("finish request line");
    stdin.flush().expect("flush request");

    let (read_result, response) = match receiver.recv_timeout(Duration::from_secs(3)) {
        Ok(received) => received,
        Err(error) => {
            child.kill().expect("kill unresponsive commander-search");
            child.wait().expect("reap unresponsive commander-search");
            reader.join().expect("join response reader");
            panic!("response did not arrive before request stream closed: {error}");
        }
    };
    assert!(read_result.expect("read response") > 0);
    assert_eq!(
        serde_json::from_str::<Value>(&response).expect("response JSON")["hits"][0]["id"],
        "settings"
    );

    drop(stdin);
    assert!(child.wait().expect("wait for commander-search").success());
    reader.join().expect("join response reader");
}

#[test]
fn binary_emits_a_structured_error_then_keeps_serving() {
    let responses = run_json_lines(&[json!({ "query": 42 }), settings_request()]);

    assert_eq!(responses.len(), 2);
    assert_eq!(responses[0]["error"]["code"], "invalid_request");
    assert_eq!(responses[1]["hits"][0]["id"], "settings");
}

#[test]
fn binary_rejects_syntactically_malformed_json_then_keeps_serving() {
    let responses = run_raw_lines(&[
        "{definitely-not-json".to_owned(),
        serde_json::to_string(&settings_request()).expect("serialize request"),
    ]);

    assert_eq!(responses.len(), 2);
    assert_eq!(responses[0]["error"]["code"], "invalid_request");
    assert_eq!(responses[1]["hits"][0]["id"], "settings");
}
