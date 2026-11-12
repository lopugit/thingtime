# Thingtime extension accounts and Website icons

PR: [#1315](https://github.com/lopugit/thingtime/pull/1315). Branch: `codex/password-website-icons`; integrated main: `edbf282dda4d46b4ce2dc375ca744cb4cf0ee571`.

The extension now discovers the current browser’s signed-in Thingtime roster and redacted saved accounts from a live first-party document on the exact configured origin. No website selection is needed to list passwords. Explicit sign-in/add/switch uses the existing first-party account switcher in an owned popup; switching also changes this browser’s Thingtime web tabs. Account cookies and session identifiers never leave that origin. Background/workspace metadata remains in memory; persisted values are preferences, a connection Lock and nonsecret owned routing/epoch values.

Identity/origin changes synchronously clear old catalog data and pending operations. Catalog cache reuse requires the same account and origin, independently of storage-event ordering. Lock survives origin changes and service-worker suspension until explicit Unlock, which reuses a live session without overriding verification preferences. Disabled/own-origin WebAuthn still uses the normal native fallback. Return focuses only the recorded extension workspace, preserving unsaved work and the sole live first-party bridge. Pending website approvals end on identity change; restart them at the original website.

Account heading, tree, session notice and return controls are editable Settings documents around the shared authentication adapter. Real Builder checks separately changed the heading and notice, saved through the actual API and verified them after reload. Existing appearance preferences and extension permissions remain unchanged; extension version is 0.4.0.

Saved password cards discover Website icons in saved order through authenticated `api.passwords` 1.6.0. The server removes saved paths/queries, validates and pins public addresses through redirects, rechecks account/revision boundaries and returns sanitized PNG. Custom icons and tree fallback remain. Editable cards use the existing bounded PNG thumbnail primitive; no renderer/sanitizer authority was added. Default Website icons have a light rounded backplate within the existing 32px footprint. Only exact prior-default CSS migrates; custom backgrounds, padding, layout edits and deletions remain user-owned.

## Verification

- Extension suite: 71 passed before main integration; imported FedCM tests: 2 passed. Imported emitted-CSP tests: 16 passed.
- Password suite: 141 passed with one existing skip; focused renderer/security/adapter suite: 21 passed; capabilities: 128 passed.
- Parent full raw TypeScript and zero-error ratchet passed; full Remix lint: no errors, 393 warnings. Final integrated ratchet recorded in release evidence.
- Real disposable API and isolated Chrome: inline sign-in, UI account switch, same-route logout, durable Lock/Unlock, no-site catalog, unavailable-refresh recovery, exact workspace return, separately editable heading/notice save/reload, desktop/narrow overflow checks.
- Website icon: first failing Website falls through to GitHub. Actual editable 64×64 image equals a fresh owner/entry/revision-bound API response, SHA-256 `4da867522bd245d053446b9476ed0822cf8d72dcd7d3a2cd2547ebe5773601e5`.
- Actual dark/light 1280/375 rendering passes; old default CSS migrates and an independently saved lavender/5px customization survives API write/reload. Four migration tests pass.

## Delivery boundaries

The production deployment, exact-head required CI and latest reachable preview are recorded in the pull request. Isolated acceptance is separate from installed-user acceptance. Personal browser control is currently unavailable; no personal 0.4 activation or native-picker/biometric claim is made. This change does not alter passkey AAGUIDs, existing credentials or relying-party-controlled artwork.
