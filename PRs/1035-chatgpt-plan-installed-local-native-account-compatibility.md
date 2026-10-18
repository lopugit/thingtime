# PR #1035: installed ChatGPT runtime compatibility

This review-only integration branch combines the installed `fc2edb8` native Passwords/menu/device changes and the subsequently installed browser manager/relay revision `62ddfda` plus menu and required browser-driver packaging fixes through `c97dbd750`, with main through `66655691` and ChatGPT feature commit `5066a1e27`. Its PR targets `codex/chatgpt-plan-usage`; do not merge it into main to promote the independently reviewed native work in #996 and #1031.

## Resolved integration boundaries

- Retain the native Passwords helper build, signing verification and bundle resources alongside local database packaging.
- Preserve Nitro server requests rather than constructing native Request objects from them. Passwords/mail capability negotiation and ChatGPT capability negotiation retain pinned endpoint authority and streaming responses.
- Bind native AutoFill to the running local/remote account authority, never a pending saved remote selection. Local HTTP accounts remain unsupported by native AutoFill; no local cookie is read for a remote endpoint.
- Clear and retire native AutoFill before persisting validated API/database changes, before runtime restart, and on local startup. A failed clear prevents saving the authority change. Retirement prevents reconnects queued during a restart; ordinary Quit/reopen and force quit after saving cannot retain the old OS connection.

- Browser task identity uses the running API authority. One shutdown barrier drains browser-manager cleanup, OAuth runtime authority and MongoDB before Electron quits. Development restarts retain the isolated process-group cleanup and optional UI inspector. Isolated backend mode refuses proxy resolution before reading any fallback authority.

## Validation

The combined integration passed 145 Electron tests, 21 proxy tests and 99 capability tests. After correcting browser task API authority, all 13 focused renderer/shutdown/Passwords tests passed and independent review cleared the merge. The browser runtime driver is retained inside app.asar and separately staged for container use; packaged smoke checks load its real dependency. Browser Actions forward expected actor/data-plane headers only through the guarded selected desktop API, while vault reveal remains local. The proxy suite exercises actual Nitro GET/POST requests for Passwords, mail and ChatGPT management. New lifecycle tests verify local AutoFill rejects before cookie access, restart waits for disconnect, and native-clear failure leaves encrypted runtime settings unchanged.

The canonical signed build is `THINGTIME_NODE_CACHE_ROOT="$HOME/Library/Caches/com.thingtime.desktop.node/chatgpt-installed" npm --prefix electron run build`; its verifier checks both native helpers and the outer bundle. Final build/installation status is recorded on PR #1035. No installation is implied by source tests. Preserve the existing app until the exact final signed bundle verifies. Live ChatGPT consent/model discovery/provider execution and installed native acceptance are separate requirements.

Graph refresh uses the immutable repository wrapper. Structural extraction completed; semantic freshness remains unverified following the guarded semantic failure. Existing Swift graph-parser warnings are not compiler diagnoses.

## Session continuity follow-up

The first installed integration changed the Electron partition and required sign-in. The correction provides explicit recovery of an original API plus exact historical loopback renderer origin, reusing the complete prior session store in place and preserving the newer store. It never infers legacy ownership from the current API selection or copies cookies. API changes, database changes and workspace recovery are serialized through one transition guard. Future restarts retain the chosen partition and renderer origin; other historical renderer origins are preserved but not merged.

A local restart also left the renderer window hidden while API and MongoDB were healthy. Window visibility now has independent load/failure/timeout paths and activation reveals an existing window. Synthetic Electron tests pass; the real two-launch Chromium storage check is blocked by macOS nested sandbox initialization and is not counted as acceptance. Signed installed recovery must verify the original API and observed old app URL before completion.

## 2026-10-19 combined source and live connection checkpoint

Integrated feature source `b06d834e8` (owned-plan admission, current main and individually editable settings) in merge `8de4fc7ff`, retaining native Passwords authority cleanup and its capability versions. Menu thumbnail source `76366e1bf` is included only in this assembly as `7da2b7424`; its promotion remains with the menu workstream. PR #1035 remains review-only and must not be merged into main.

Merge validation passed all 169 Electron tests and 116 combined proxy/capability tests. The selected-endpoint proxy keeps the feature branch's options signature and the assembly's Passwords/mail manifest checks. The complete prior graph snapshot was retained during conflict resolution; the final integrated source will receive an incremental refresh.

The previously installed `6de54fb70` completed user-approved real OpenAI consent, discovered a ChatGPT model, and preserved its local account and connection through normal Quit/reopen. Saved-credential model refresh passed. First live Lopu inference remains pending the next signed installed build containing the owned-plan admission correction. No administrative account grant was used.

## 2026-10-19 installed inference checkpoint

The canonical build and installer completed for runtime source `116f95ee2`. The installed `~/Applications/Thingtime.app` passes the installer's deep strict signature verification with Developer ID team `6DQQ9V7C84`; its local API and MongoDB start successfully and preserve the existing local account and saved ChatGPT connection. Selecting that connection unlocks the non-invited account's composer. After choosing local chat management, the first real `gpt-6.1-sol` response succeeded through the saved ChatGPT plan. The response, conversation, and provider selection survived a renderer reload.

Live acceptance identified three remaining failures: the initial server-management preference attempted unavailable Vercel Workflow startup; a follow-up send rejected identical provider settings as “Nothing to update”; a read-only `list_my_things` roundtrip ended without a tool result. These are tracked as incomplete acceptance, not waived by the successful text response. No API-key fallback or administrative account grant was used.

The installed settings Builder independently selected a nested local-runtime legend, changed its text, saved the account-owned layout, and retained the change after reload. The original wording was then restored and saved. Runtime endpoints and credentials were unchanged.

The next assembly includes menu follow-ups `a50e26fc4`, `6fc65465c`, and `3b64aa6d9` as `54261e2c0`, `52be9beb1`, and `9835f6b73`. Only their applicable product changes and existing template regression were retained; the other workstream's absent PR note and newer browser fixture were not imported. The combined template tests pass 5/5. These changes are not yet in the installed `116f95ee2` bundle.
