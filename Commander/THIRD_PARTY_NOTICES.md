# Third-party notices

## Emojibase Data 17.0.0

Commander’s bundled Emoji & Symbols catalog includes data from
[Emojibase](https://emojibase.dev/).

MIT License

Copyright (c) 2017-2019 Miles Johnson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Commander filesystem indexer dependencies

The bundled `commander-indexer` binary statically includes SQLite through
`libsqlite3-sys`/`rusqlite` and uses the Rust `ignore`, `globset`, and `regex`
crates. Exact resolved versions are recorded in
`crates/commander-indexer/Cargo.lock`.

- SQLite is in the public domain: https://sqlite.org/copyright.html
- rusqlite is licensed under MIT: https://github.com/rusqlite/rusqlite
- ignore and globset are dual-licensed under Unlicense or MIT:
  https://github.com/BurntSushi/ripgrep
- regex is dual-licensed under MIT or Apache-2.0:
  https://github.com/rust-lang/regex

The complete license texts for resolved Rust crates are available from their
upstream source distributions and must remain included by any downstream app
that redistributes the standalone indexer.
