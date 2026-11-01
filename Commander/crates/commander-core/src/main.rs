//! Persistent JSON-lines adapter for the Commander search library.

#![forbid(unsafe_code)]

use commander_core::{
    search, validate_request, SearchErrorResponse, SearchRequest, SearchResponse,
};
use std::env;
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::process::ExitCode;

const MAX_REQUEST_LINE_BYTES: usize = 64 * 1024 * 1024;

const HELP: &str = "commander-search

Reads one SearchRequest JSON object per line from stdin and writes one response
per non-empty line to stdout. Successful responses have {\"hits\":[...]}; malformed
requests have {\"error\":{\"code\":\"invalid_request\",\"message\":...}}.
";

fn main() -> ExitCode {
    let mut arguments = env::args().skip(1);
    match arguments.next().as_deref() {
        None => run(io::stdin().lock(), io::stdout().lock()),
        Some("-h" | "--help") => {
            print!("{HELP}");
            ExitCode::SUCCESS
        }
        Some("-V" | "--version") => {
            println!("commander-search {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Some(argument) => {
            eprintln!("unknown argument: {argument}\n\n{HELP}");
            ExitCode::from(2)
        }
    }
}

fn run(reader: impl BufRead, writer: impl Write) -> ExitCode {
    let mut reader = BufReader::new(reader);
    let mut writer = BufWriter::new(writer);
    let mut line_number = 0;

    loop {
        let mut bytes = Vec::new();
        let bytes_read = match read_bounded_line(&mut reader, &mut bytes) {
            Ok(bytes_read) => bytes_read,
            Err(error) => {
                eprintln!("failed to read stdin after line {line_number}: {error}");
                return ExitCode::FAILURE;
            }
        };
        if bytes_read == 0 {
            break;
        }
        line_number += 1;

        if bytes.len() > MAX_REQUEST_LINE_BYTES {
            if bytes.last() != Some(&b'\n') {
                if let Err(error) = discard_through_newline(&mut reader) {
                    eprintln!("failed to discard oversized line {line_number}: {error}");
                    return ExitCode::FAILURE;
                }
            }
            if !write_response(
                &mut writer,
                &SearchErrorResponse::request_too_large(line_number, MAX_REQUEST_LINE_BYTES),
            ) {
                return ExitCode::FAILURE;
            }
            continue;
        }

        if bytes.iter().all(|byte| byte.is_ascii_whitespace()) {
            continue;
        }

        match serde_json::from_slice::<SearchRequest>(&bytes) {
            Ok(request) => match validate_request(&request) {
                Ok(()) => {
                    let response = SearchResponse {
                        hits: search(&request),
                    };
                    if !write_response(&mut writer, &response) {
                        return ExitCode::FAILURE;
                    }
                }
                Err(error) => {
                    if !write_response(
                        &mut writer,
                        &SearchErrorResponse::invalid_request(line_number, error),
                    ) {
                        return ExitCode::FAILURE;
                    }
                }
            },
            Err(error) => {
                if !write_response(
                    &mut writer,
                    &SearchErrorResponse::invalid_request(line_number, error.to_string()),
                ) {
                    return ExitCode::FAILURE;
                }
            }
        }
    }

    match writer.flush() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("failed to flush stdout: {error}");
            ExitCode::FAILURE
        }
    }
}

fn read_bounded_line(reader: &mut impl BufRead, output: &mut Vec<u8>) -> io::Result<usize> {
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(output.len());
        }

        let remaining = MAX_REQUEST_LINE_BYTES + 1 - output.len();
        let newline_length = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        let consumed = newline_length.min(remaining);
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

fn write_response(writer: &mut impl Write, response: &impl serde::Serialize) -> bool {
    if let Err(error) = serde_json::to_writer(&mut *writer, response) {
        eprintln!("failed to write stdout: {error}");
        return false;
    }
    if let Err(error) = writeln!(writer) {
        eprintln!("failed to write stdout: {error}");
        return false;
    }
    if let Err(error) = writer.flush() {
        eprintln!("failed to flush stdout: {error}");
        return false;
    }
    true
}
