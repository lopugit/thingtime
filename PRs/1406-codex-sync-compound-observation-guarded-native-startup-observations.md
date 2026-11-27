# PR #1406 — guarded native startup observations

[Pull request](https://github.com/lopugit/thingtime/pull/1406)

Two-way preparation now negotiates Mac file access 1.21.0 and requests current
policy plus candidate/immediate-parent observations through one typed native
boundary. Current saved configuration is checked before IO. Native identity is
fresh at entry and reply, with current conditions, expiry, bookmark, cancellation
and measured reader CPU around each observation. Unavailable metadata is an
explicit failed observation, never absence. Legacy hosts retain their strict
path; later mutations and payload reads independently authorize.

On 7 November 2026, one matched synthetic healthy/recovery pair retained
5,000,000 B/s scan/transfer, 15% CPU, exact byte hashes, strict checkpoint,
original operation IDs and no duplicate effects. Healthy first upload improved
38.522 → 30.717 seconds; scan-to-first-read 36.158 → 28.351 seconds; union
identity admission wait 20.730 → 12.857 seconds. Startup context/inspect counts
14/12 became 4/2 plus ten compound observations. Recovery passed lost accepted
replies and native restart, with first upload at 37.049 seconds. These bounded
measurements do not establish a population-wide latency guarantee or personal
folder/installed-GUI transfer acceptance.

Validation includes the file-sync suite, native folder/identity tests, focused
compound race/refusal/protocol tests, Electron host checks, TypeScript and both
Vercel/node middleware builds. The scoped independent review found no blockers.
The renderer queue retains its existing timeout; the new 30-second deadline
covers Electron/native admission and execution. Signed local delivery is a
separate release check recorded in the PR's final validation.

Local receipts are under `/tmp/tt-sync-compound-observation`. Native test-only
unknown action labels were joined by exact session/request ID to transport
labels; canceled checks without complete intervals remain explicit. Structural
Graphify outputs are current; changed Markdown semantic extraction was stopped
at the account budget checkpoint and was not activated.
