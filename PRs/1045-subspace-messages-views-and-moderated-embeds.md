# PR 1045 — Subspace messages, saved views and moderated embeds

PR: https://github.com/lopugit/thingtime/pull/1045
Branch: `codex/subspace-messages-views`

## Behavior

Every new subspace receives one deterministic Messenger space and general channel. The registered `subspace-messaging-spaces` migration provisions existing subspaces in bounded, retry-safe batches. Message access follows current subspace access, membership and bans, including previews and media. Deleting a subspace removes its dependent messaging and embed records without deleting shared referenced Things.

Subspaces expose editable Posts/Messages controls and a saved Expand all comments preference scoped to origin, account, data plane and subspace. Switching views preserves drafts and pauses hidden message polling/read receipts. Expansion covers loaded comments and replies while keeping pagination bounded.

Moderators can search accessible Things, add, reorder and remove relational placements in the sidebar and between the composer and first post. Each viewer must independently retain access to a referenced Thing. Placement controls and repeated card titles are individually editable Builder blocks.

## Verification — 2026-10-19

The final isolated real-API and Chrome for Testing acceptance run exited 0. Both browser and backend were constrained by an OS network sandbox to disposable loopback services; direct-IP and redirect boundary probes passed. No production credentials or data were used. The run exercised messaging send/read/retry, current-member and revoked-member access, preview redaction, private/public changes, embed source revocation, cross-page ordering, replay safety, deletion and repeat deletion.

Desktop and 390px browser checks exercised both views, top-to-bottom scrolling, persisted preferences, account/subspace isolation, drafts, actual search-picker selection, embed add/remove, and independent Builder edits to a view-control label, an embed action button and a repeated card title followed by save/reload. Rendered sidebar placements were compared with the API result. Browser result was `ok:true`, with no browser errors. Test processes and ports were verified released.

Local evidence: `/tmp/thingtime-subspace-acceptance-evidence/final-acceptance.log`, `browser-result.json`, `browser-progress.log` and the accompanying screenshots. These temporary artifacts are evidence locations, not committed fixtures.

Regression suites passed for subspaces, Messenger, attachments, migrations, API capabilities, view preferences, protected Things, content slots and grouped search results. Client and portable Nitro builds passed. Changed-file lint had no errors; the repository typecheck ratchet reports 92 errors against its stored 89 baseline, with no errors attributed to the owned frontend files in the reviewed output.

Acceptance found and fixed grouped-search dictionary handling and a StrictMode request-coalescing race. The harness retains bounded request timing and redacted database diagnostics after one non-reproducing 30-second API timeout; the same request completed normally on the bounded rerun.

The installed browser manager socket was unavailable, so the supported isolated runner fallback was used. The fresh, unmodified vendor Chromium bundle failed the strict signature resource check; that limitation is recorded in `browser-signature-verification.txt`. No signature or bundle modification was used to work around it.

## Delivery still required

Exact final-head CI, merge, production deployment and authenticated existing-subspace migration/production acceptance remain separate gates. A local acceptance pass does not prove those gates. The current PR preview is https://pr-1045.previews.dev.thingtime.com; deployment identity must be rechecked after the final push.

Graphify semantic extraction produced a usable snapshot but reported hollow/truncated document results and pre-existing duplicate Swift symbol IDs. Preserve these limitations rather than claiming complete semantic coverage.
