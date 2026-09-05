//! Standalone CLI and persistent JSON-lines adapter for commander-indexer.

#![forbid(unsafe_code)]

use commander_indexer::{
    IndexConfiguration, IndexDatabase, IndexKind, IndexProgress, IndexerError, IndexerErrorBody,
    IndexerErrorResponse, IndexerOperation, IndexerRequest, IndexerSuccessResponse, QueryRequest,
};
use serde::Serialize;
use serde_json::Value;
use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::process::ExitCode;

const MAX_REQUEST_LINE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexerProgressResponse<'a> {
    id: &'a str,
    event: &'static str,
    progress: &'a IndexProgress,
}

const HELP: &str = "commander-indexer

Usage:
  commander-indexer serve --database <path>
  commander-indexer index --database <path> --config <configuration.json>
  commander-indexer query --database <path> --query <text> [--kind <kind>] [--limit <count|all>]
  commander-indexer status --database <path>

Kinds: application, file, directory

The serve command reads one correlated JSON request per line and writes one
response per line. See README.md for the protocol and configuration format.
";

fn main() -> ExitCode {
    match run_cli(env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{}: {}", error.code, error.message);
            ExitCode::FAILURE
        }
    }
}

fn run_cli(arguments: Vec<String>) -> Result<(), IndexerError> {
    if arguments.is_empty()
        || arguments
            .iter()
            .any(|argument| argument == "-h" || argument == "--help")
    {
        print!("{HELP}");
        return Ok(());
    }
    if arguments
        .iter()
        .any(|argument| argument == "-V" || argument == "--version")
    {
        println!("commander-indexer {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let command = arguments[0].as_str();
    let database_path = required_value(&arguments, "--database")?;
    let mut database = IndexDatabase::open(database_path)?;
    match command {
        "serve" => serve(&mut database, io::stdin().lock(), io::stdout().lock()),
        "index" => {
            let config_path = required_value(&arguments, "--config")?;
            let configuration: IndexConfiguration = serde_json::from_slice(&fs::read(config_path)?)
                .map_err(|error| IndexerError::new("invalid_configuration", error.to_string()))?;
            write_json(io::stdout().lock(), &database.index(&configuration)?)
        }
        "query" => {
            let query = optional_value(&arguments, "--query").unwrap_or_default();
            let limit = optional_value(&arguments, "--limit")
                .map(|value| {
                    if value == "all" {
                        Ok(None)
                    } else {
                        value.parse::<usize>().map(Some).map_err(|_| {
                            IndexerError::new(
                                "invalid_argument",
                                "--limit must be a nonnegative integer or all",
                            )
                        })
                    }
                })
                .transpose()?
                .unwrap_or(Some(50));
            let kinds = repeated_values(&arguments, "--kind")
                .into_iter()
                .map(parse_kind)
                .collect::<Result<Vec<_>, _>>()?;
            write_json(
                io::stdout().lock(),
                &database.query(&QueryRequest {
                    query,
                    kinds,
                    limit,
                })?,
            )
        }
        "status" => write_json(io::stdout().lock(), &database.status()?),
        _ => Err(IndexerError::new(
            "invalid_argument",
            format!("unknown command: {command}\n\n{HELP}"),
        )),
    }
}

fn serve(
    database: &mut IndexDatabase,
    reader: impl BufRead,
    writer: impl Write,
) -> Result<(), IndexerError> {
    let mut reader = BufReader::new(reader);
    let mut writer = BufWriter::new(writer);
    loop {
        let mut bytes = Vec::new();
        let length = read_bounded_line(&mut reader, &mut bytes)?;
        if length == 0 {
            break;
        }
        if bytes.len() > MAX_REQUEST_LINE_BYTES {
            if bytes.last() != Some(&b'\n') {
                discard_through_newline(&mut reader)?;
            }
            write_error(
                &mut writer,
                String::new(),
                &IndexerError::new(
                    "request_too_large",
                    format!("request exceeds the {MAX_REQUEST_LINE_BYTES}-byte limit"),
                ),
            )?;
            continue;
        }
        if bytes.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let parsed = serde_json::from_slice::<IndexerRequest>(&bytes);
        match parsed {
            Ok(request) => {
                let id = request.id.clone();
                match request.operation {
                    IndexerOperation::Index { configuration } => {
                        let report =
                            database.index_with_progress(&configuration, &mut |progress| {
                                write_json_line(
                                    &mut writer,
                                    &IndexerProgressResponse {
                                        id: &id,
                                        event: "progress",
                                        progress,
                                    },
                                )
                            });
                        match report.and_then(|report| {
                            serde_json::to_value(report)
                                .map_err(|error| {
                                    IndexerError::new("serialization_error", error.to_string())
                                })
                                .map(|result| IndexerSuccessResponse {
                                    id: id.clone(),
                                    ok: true,
                                    result,
                                })
                        }) {
                            Ok(response) => write_json_line(&mut writer, &response)?,
                            Err(error) => write_error(&mut writer, id, &error)?,
                        }
                    }
                    operation => match database.handle_request(IndexerRequest {
                        id: id.clone(),
                        operation,
                    }) {
                        Ok(response) => write_json_line(&mut writer, &response)?,
                        Err(error) => write_error(&mut writer, id, &error)?,
                    },
                }
            }
            Err(error) => {
                let id = serde_json::from_slice::<Value>(&bytes)
                    .ok()
                    .and_then(|value| value.get("id")?.as_str().map(ToOwned::to_owned))
                    .unwrap_or_default();
                write_error(
                    &mut writer,
                    id,
                    &IndexerError::new("invalid_request", error.to_string()),
                )?;
            }
        }
    }
    writer.flush()?;
    Ok(())
}

fn write_error(
    writer: &mut impl Write,
    id: String,
    error: &IndexerError,
) -> Result<(), IndexerError> {
    write_json_line(
        writer,
        &IndexerErrorResponse {
            id,
            ok: false,
            error: IndexerErrorBody {
                code: error.code.to_owned(),
                message: error.message.clone(),
            },
        },
    )
}

fn write_json(mut writer: impl Write, value: &impl Serialize) -> Result<(), IndexerError> {
    serde_json::to_writer_pretty(&mut writer, value)
        .map_err(|error| IndexerError::new("serialization_error", error.to_string()))?;
    writeln!(writer)?;
    Ok(())
}

fn write_json_line(writer: &mut impl Write, value: &impl Serialize) -> Result<(), IndexerError> {
    serde_json::to_writer(&mut *writer, value)
        .map_err(|error| IndexerError::new("serialization_error", error.to_string()))?;
    writeln!(writer)?;
    writer.flush()?;
    Ok(())
}

fn required_value(arguments: &[String], flag: &str) -> Result<PathBuf, IndexerError> {
    optional_value(arguments, flag)
        .map(PathBuf::from)
        .ok_or_else(|| IndexerError::new("invalid_argument", format!("{flag} is required")))
}

fn optional_value(arguments: &[String], flag: &str) -> Option<String> {
    arguments
        .iter()
        .position(|argument| argument == flag)
        .and_then(|index| arguments.get(index + 1))
        .cloned()
}

fn repeated_values(arguments: &[String], flag: &str) -> Vec<String> {
    arguments
        .iter()
        .enumerate()
        .filter_map(|(index, argument)| {
            (argument == flag)
                .then(|| arguments.get(index + 1))
                .flatten()
        })
        .cloned()
        .collect()
}

fn parse_kind(value: String) -> Result<IndexKind, IndexerError> {
    match value.as_str() {
        "application" => Ok(IndexKind::Application),
        "file" => Ok(IndexKind::File),
        "directory" => Ok(IndexKind::Directory),
        _ => Err(IndexerError::new(
            "invalid_argument",
            format!("unknown kind: {value}"),
        )),
    }
}

fn read_bounded_line(reader: &mut impl BufRead, output: &mut Vec<u8>) -> io::Result<usize> {
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(output.len());
        }
        let remaining = MAX_REQUEST_LINE_BYTES + 1 - output.len();
        let through_newline = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        let consumed = through_newline.min(remaining);
        output.extend_from_slice(&available[..consumed]);
        reader.consume(consumed);
        if output.last() == Some(&b'\n') || output.len() > MAX_REQUEST_LINE_BYTES {
            return Ok(output.len());
        }
    }
}

fn discard_through_newline(reader: &mut impl BufRead) -> io::Result<()> {
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(());
        }
        match available.iter().position(|byte| *byte == b'\n') {
            Some(index) => {
                reader.consume(index + 1);
                return Ok(());
            }
            None => {
                let length = available.len();
                reader.consume(length);
            }
        }
    }
}
