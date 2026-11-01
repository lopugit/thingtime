# Commander search core

`commander-core` is Commander's portable, deterministic fuzzy-search engine. It
contains no OS APIs and builds from the same source on macOS, Windows, and Linux.
The host keeps the `commander-search` process alive and exchanges one compact JSON
object per line, avoiding process startup on every keystroke.

## JSON-lines protocol

Input is a `SearchRequest` aligned with `Commander/packages/protocol`:

```json
{
  "query": "settings",
  "limit": 20,
  "items": [
    {
      "id": "settings",
      "title": "Settings",
      "kind": "builtin",
      "favourite": true,
      "actions": [{ "id": "open", "title": "Open" }]
    }
  ]
}
```

Success and error responses are deliberately distinguishable without inspecting
stderr:

```json
{"hits":[{"id":"settings","title":"Settings","kind":"builtin","favourite":true,"actions":[{"id":"open","title":"Open"}],"score":10535,"matchedRanges":[{"start":0,"end":8}]}]}
{"error":{"code":"invalid_request","message":"line 1: ..."}}
```

`matchedRanges` are half-open JavaScript UTF-16 offsets in the title. This keeps
emoji and other supplementary Unicode characters aligned when React highlights a
result.

An optional `actionFilter` filters by exact action IDs before ranking:

```json
{ "actionFilter": { "anyOf": ["open", "copy"], "allOf": ["open"], "noneOf": ["delete"] } }
```

Empty filter lists impose no constraint. `anyOf` needs one match, `allOf` needs
every match, and `noneOf` rejects any match.

## Ranking contract

- Case-insensitive subsequence matching supports gaps, word boundaries, and camel-case boundaries.
- Exact, prefix, consecutive, boundary, and coverage bonuses use integer arithmetic only.
- Title, subtitle, and keyword weights are `100`, `50`, and `25` respectively.
- Favourites receive a small deterministic bonus.
- Final ties use favourite status, folded title, item kind, ID, then original ordinal.
- Queries, individual fields, and per-item keyword scans are bounded before dynamic-programming work to keep untrusted extension metadata from causing unbounded CPU or memory use.
- The adapter rejects request lines over 64 MiB and catalogs over 100,000 items; finite result limits use partial selection and clone only winning items.

## Development

```sh
cargo fmt --check --manifest-path Commander/crates/commander-core/Cargo.toml
cargo test --manifest-path Commander/crates/commander-core/Cargo.toml
cargo clippy --all-targets --all-features --manifest-path Commander/crates/commander-core/Cargo.toml -- -D warnings
```
