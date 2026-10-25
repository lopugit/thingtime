# Check results — 25 October 2026

These are local verification results for the source/package snapshot captured by each command. They do not imply CI, deployment, provider, or installed-device acceptance. Focused counts can overlap the workspace suite.

| Check | Result | Evidence |
|---|---:|---|
| Local workspace tests | 827 pass, 0 fail, 96 opt-in skips | [workspace.log](workspace.log) |
| Offline shell | 4 pass, 0 fail, 0 skipped | appended second suite in [workspace.log](workspace.log) |
| Attachments | 360 pass, 0 fail; 12 prechecks reported separately | [attachments.log](attachments.log) |
| API capabilities | 133 pass, 0 fail | [capabilities.log](capabilities.log) |
| TypeScript baseline comparison | 91 baseline / 91 current; 0 added, 0 removed | [typecheck-comparison.json](typecheck-comparison.json), [typecheck.log](typecheck.log) |
| Reviewed-source lint | 0 errors, 3 baseline warnings | [lint.log](lint.log) |
| Workflow callers | recorded separately | [workflow-callers.log](workflow-callers.log) |
| MCP security build | `tsc -p tsconfig.json` succeeds | [mcp-security-build.log](mcp-security-build.log) |
| MCP security tests | 42 pass, 3 skipped, 0 fail | [renderer-guardian-all-tests.log](renderer-guardian-all-tests.log) |
| MCP artifact extractor | 3 pass, 0 skipped, 0 fail | [mcp-security-extractor.log](mcp-security-extractor.log) |
| MCP stdio framing | 2 pass, 0 fail | [renderer-framing-tests.log](renderer-framing-tests.log) |
| MCP package audit | 0 vulnerabilities | [mcp-security-audit.json](mcp-security-audit.json) |

The skipped tests depend on external runtime surfaces. They remain skipped, not accepted. The lint warnings are existing baseline warnings, not errors. Typecheck equality is based on the normalized diagnostic comparison, ignoring only source line/column offsets while retaining diagnostic file, code, and message.

## MCP CLI host evidence

The CLI agent host's `thingtime-drafts` connection, valid render/export, invalid-request refusal, extracted resource hashes, and viewport dimensions are recorded in [`../cli-agent-host/host-proof.json`](../cli-agent-host/host-proof.json) and [`../cli-agent-host/verification.json`](../cli-agent-host/verification.json). Invalid input was rejected without producing artifacts. The actual canonical JSON and PNGs are retained under [`../cli-agent-host/`](../cli-agent-host/).

Automatic runtime cleanup did not complete as expected. The exact owned runtime was inspected; the owned UUID container and volume were then explicitly removed and their absence verified. No global prune was run. The detached guardian fix passes five focused process/ownership/expiry regressions; actual Docker lifecycle acceptance is blocked by ENOSPC on the dedicated daemon. The earlier host run remains evidence of explicit cleanup only, not automatic-cleanup acceptance. See [`../cli-agent-host/cleanup.json`](../cli-agent-host/cleanup.json).

## Scope exclusions

The CLI agent-host check does not verify the current desktop chat's tool reload. The rendered/imported, Builder, protected-recovery, and Shared Copy checks are separate native acceptance scenarios tied to the package hashes listed in the [artifact README](../README.md). Linux fixture boundaries do not establish macOS installation, real-account, provider, or device acceptance. The textarea actionability failure and outstanding worker/guardian diagnosis are listed as incomplete in the [artifact README](../README.md).

The oversized-instructions behavioral check passes with exact offline retention and no repeated request over 65,008 ms; the 390 px guidance capture needs the corrected all-lines-visible rerun. The earlier clipped capture and successful behavior record are preserved together. Final native lifecycle and plan capture are blocked by the full dedicated Docker disk.

Graphify semantic refresh: the CLI reported every file changed and was stopped before proceeding to the full semantic corpus. The healthy local proxy does not establish semantic freshness. See [graph-refresh.json](graph-refresh.json); final structural refresh is recorded separately.

Retained check logs normalize terminal color escapes and trailing whitespace for review; command results and diagnostic text are preserved. Raw command logs remain in the task-local `/tmp` captures. Archived failure evidence and its recorded hashes were not rewritten.

Structural graph generation passes: 69,599 nodes, 206,112 edges, 1,443 communities; portable report and aggregated HTML were regenerated. Five native/Gradle files have partial parser coverage and 468 code/data files yield no symbols. These extractor limitations are recorded in [the structural log](graph-structural.log); they are not application build failures. The final source fingerprint is checked against the committed snapshot before push.
