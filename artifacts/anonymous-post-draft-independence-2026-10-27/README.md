# Posting and draft persistence independence — 27 October 2026

The **existing** `remix/app/local-workspace/accountDraftSync.browser.test.ts` passed with focused additional assertions. This work adds no product queue or product source implementation. The retained suite already exercised the ordinary feed composer and both failure directions.

## Result and new assertions

- Normal UI posting reaches the real disposable backend while a draft-save request remains held. The draft request is later returned as 503.
- A final editor edit made immediately before clicking Post appears in exact-ID remote readback. The stored rich-text document equals the real composer request document.
- A late draft failure and reload produce one first-post request and one matching server post.
- In the reverse direction, the ordinary composer submits another private post while its backend write is held, then creates a separate draft which reaches the backend before the post is released.
- That post receives 503, retries with the identical payload/identity, and produces exactly one server post. The independent working draft survives post retry and reload.
- Existing private-access, template idempotency, offline cold reload and 1440/390/320px picker checks also pass. Post retry statuses were `[503, 200]`; there were no browser page errors or offline mutation requests.

`run.log`: 1 test passed, 0 failed, 0 skipped, 32.25 seconds. `lint.log`: targeted ESLint passed; `git diff --check` passed. `verification.json` contains measured assertions and synthetic record IDs.

## Isolation and provenance

The supported task browser-manager fixture launched a disposable Docker runtime with network mode `none`, no published ports, and Chromium sandbox enabled. Browser and backend egress tests cover IPv4, IPv4-mapped IPv6, IPv6, DNS and loopback-to-external redirects; see `network-proof.json` and `boundary.json`. The CDP online signal models loopback connectivity without adding an external route. The actual app/API and temporary replica set run inside this same network boundary. Only randomly generated disposable identities were created through the normal registration API. No production, real-account credentials, shared LLM proxy, VM configuration, installed application or deployment was changed.

`source-provenance.json` confirms five relevant runtime sources match the existing sanitized bundle's source maps; the package hash is in `package.json`. The app was not rebuilt. `cleanup.json` confirms no task runtime remains. `resources.json` records zero OOM kills. These are local isolated acceptance results, separate from CI, deployed origins or installed-app acceptance.

## Earlier evidence and fixture correction

`prior/` preserves the original synthetic Character verification with its original path and scope. It proves an already-completed offline post synced while a **different new draft** received three 503s; it does not prove direct composer submission while its own draft remains pending.

`initial-fixture-failure/` retains the first attempted duplicate fixture failure and its cleanup/provenance. No draft HTTP request occurred because that fixture omitted the existing loopback browser online-signal setup. This is not product failure evidence. The duplicate test was removed and the retained suite was strengthened instead.

## Limits

The rejected content path here is a remote queue refusal (503) with retained local post and retry, consistent with the existing local-first contract. It does not claim a remote refusal restores the composer, or establish additional synchronous validation behavior. No product failure was found and no product fix was proposed.

To rerun, bundle the retained test with esbuild for Node and invoke it inside the documented disposable agent-browser runtime with `TT_LOCAL_ACCOUNT_DRAFTS_URL`, `TT_RENDER_SESSION`, `TT_LOCAL_ACCOUNT_DRAFTS_ARTIFACTS`, `TT_SHARED_PLAYWRIGHT_PATH`, and `TT_SHARED_CHROME_PATH`. The test itself verifies the loopback test-health identity before creating fixtures. The task-local runner used here is `tmp/continuation/post-draft-native-run.cjs`; it is not committed product tooling.

## Current plan and preceding pushed commit

`plan/verification.json` records all 89 checklist rows (65 complete,13 partial,
11 planned;24 Remaining), filter/search behavior and full-page traversal at
1440/390/320px without overflow. Its exact copied HTML/source hash, screenshots,
network boundary and cleanup are retained under `plan/`.

`ci-preview.json` records successful Web CI/CodeQL for preceding pushed source
`ae245f48`, plus public HTTP checks of its GitHub-associated immutable preview.
This test/evidence increment requires its own pushed-head checks; these probes
do not establish deployed functional or installed-app acceptance.
