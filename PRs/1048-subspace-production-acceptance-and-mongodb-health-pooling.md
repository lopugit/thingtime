# PR 1048 — Subspace acceptance and MongoDB health pooling

PR: https://github.com/lopugit/thingtime/pull/1048
Branch: `codex/subspace-production-acceptance`

## Problem and behavior

Production acceptance of merged PR #1045 encountered intermittent HTTP 500s on subspace detail, embeds and session loading. Vercel logs identified MongoDB TLS alert 80 / server-selection failures. Fresh health connections failed on current and older deployments. The Atlas alert reported 92.6% connection utilization at 19:32 AEDT on 2026-10-19; the live graph showed 482 active connections at 19:44:06 during the same failure window. This supports connection pressure as a contributor, without proving that every failure has that cause.

The MongoDB status helper created and closed a separate client on every request. Health/status reads now reuse the selected application pool, coalesce overlapping checks for the same connection and database, and retain a two-second diagnostic deadline. They do not adopt collections, build indexes, or close the shared client. Home-pool idle sockets expire after 60 seconds. Selected custom databases remain isolated, including failure responses. No cluster tier, credentials, TLS settings or network access rules are changed.

The three status API features receive compatible PATCH versions. Existing response fields and client compatibility remain unchanged.

## Acceptance coverage

The subspace harness now embeds an ordinary Editor.js rich-text post in both feed and sidebar and compares both projections with its source. The full isolated API and desktop/390px browser run passed with no page errors, including view switching, comment expansion, saved preferences, drafts and nested Builder edits. Browser and backend network boundaries remained enforced and disposable test processes were released.

Evidence is retained locally under `/tmp/thingtime-rich-post-embed-evidence/`. Sanitized production failure evidence and the Atlas graph are under `/tmp/thingtime-subspace-acceptance-evidence/`.

The pooling fix passed 68 collection tests (including eight health tests), 104 capability tests, lint, and the built Node server acceptance harness. That harness verified all three PATCH manifests, four concurrent real-driver health requests, and a subsequent ordinary subspace write/read. Full typecheck reports 92 existing diagnostics outside the owned files, with none in the changed pooling or capability files.

Production recovery remains pending. Passing isolated tests is not evidence that Atlas connection pressure has cleared. Final delivery must verify the deployed status contracts, fresh application reads, saved subspace views and rendered embeds after rollout.
