# PR 1341: Approved provider imports and agent authentication workflows

- Branch: `codex/credential-handoff`; initial base: `b273c14d8107613fa354e6156343a64558588474`.
- PR: https://github.com/lopugit/thingtime/pull/1341 (base `main`).
- Scope: write-only provider-file handoff, direct editable importer, Google web OAuth adapter, capability contracts and agent runbooks.

## Delivered behavior

A Node helper reads the selected file or protected pipe only after a root administrator approves its account, origin, environment, label, format and replacement revision in Thingtime. A one-use S256 proof carries bytes directly to the canonical encrypted provider vault; only receipt metadata returns. The browser can also import a file or masked pasted value directly. Google imports preserve other environment/origin entries. Text/JSON use each consuming integration's documented label and structure; no universal provider-schema claim is made.

Session selection revisions and transactional authorization fences prevent Character overrides or approval revival after switching away and back. Exact ID/revision CAS, immutable input replay, cancellation/status reconciliation and frame-deny headers protect the handoff. Anonymous control metadata has admission controls; the fixed proof envelope is distinct from user credential data. Existing vault encryption and indexes are reused.

## Verified locally on 2026-11-04

- Final client, Nitro node server and Vercel builds; OAuth runtime packaging and output verification passed.
- TypeScript and its ratchet: zero errors. Full ESLint: zero errors, 407 warnings.
- Import core/service/CLI, capability coverage, Character behavior, gateway signatures and Vercel configuration tests passed. The final CLI suite has nine checks, including partial/null receipts and intermediary HTTP 500 recovery.
- Built API acceptance used a disposable replica set and isolated Chromium with synthetic credentials. It exercised all seven routes, CLI approval/save/receipt reload, direct Google JSON replacement, origin preservation, stale CAS, wrong account/proof, revocation/replay, Character switching and frame refusal. Test resources were cleaned.
- Desktop/mobile full scroll, keyboard and review states, identity clearing, and nested Builder edits/save/reload passed. No secrets are persisted in layout Things.
- Global instructions updated at `/Users/lopu/.AI/AI_ALL.md`; canonical symlink validation passed. Repository instructions link to `docs/agent-credential-workflows.md`.

## Evidence boundaries and release

Hosted CI, preview, merge and production acceptance are recorded in the PR checks and task plan as they occur. A saved receipt is not proof of Google/Meta OAuth or a platform's installed AutoFill/passkey provider. The Node contract is portable; native platform ceremonies still require separate acceptance and any required user presence.

Graphify structural output is current. The semantic refresh of eight large documentation files was stopped after a bounded slow run; full refreshed semantic coverage is not claimed. The new guide remains represented structurally in the graph and manifest.
