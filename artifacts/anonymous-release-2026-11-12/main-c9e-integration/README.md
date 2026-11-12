# Main integration — 12 November 2026

Fetched and merged canonical main c9e1bf9c438dc9e11da5b5072e95324e244e8c8e
(Photos recovery/scoped transfer limits and mobile password icon layout) into
PR #1000. Both documentation contributions are retained; generated graph snapshots
are regenerated from the combined source rather than hand merged.

The resolved password layout keeps the incoming single flexible grid track and
this branch's missing-min-width repair while preserving authored CSS. Both
regressions pass. Both capability generators retain the higher combined contracts
and incoming Files 1.13.1. Focused checks: 206 capability tests, 8 icon tests,
zero lint errors/warnings. SQLite's nine frozen source hashes remain unchanged.
The final combined build and actual native runs have separate source receipts.
