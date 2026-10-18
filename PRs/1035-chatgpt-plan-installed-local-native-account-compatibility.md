# PR #1035: installed ChatGPT runtime compatibility

This review-only integration branch combines the installed `fc2edb8` native Passwords/menu/device changes with main through `66655691` and ChatGPT feature commit `5066a1e27`. Its PR targets `codex/chatgpt-plan-usage`; do not merge it into main to promote the independently reviewed native work in #996 and #1031.

## Resolved integration boundaries

- Retain the native Passwords helper build, signing verification and bundle resources alongside local database packaging.
- Preserve Nitro server requests rather than constructing native Request objects from them. Passwords/mail capability negotiation and ChatGPT capability negotiation retain pinned endpoint authority and streaming responses.
- Bind native AutoFill to the running local/remote account authority, never a pending saved remote selection. Local HTTP accounts remain unsupported by native AutoFill; no local cookie is read for a remote endpoint.
- Clear and retire native AutoFill before persisting validated API/database changes, before runtime restart, and on local startup. A failed clear prevents saving the authority change. Retirement prevents reconnects queued during a restart; ordinary Quit/reopen and force quit after saving cannot retain the old OS connection.

## Validation

124 Electron tests, 18 proxy tests and 98 capability tests passed. The proxy suite exercises actual Nitro GET/POST requests for Passwords, mail and ChatGPT management. New lifecycle tests verify local AutoFill rejects before cookie access, restart waits for disconnect, and native-clear failure leaves encrypted runtime settings unchanged.

The canonical signed build is `npm --prefix electron run build`; its verifier checks both native helpers and the outer bundle. Final build/installation status is recorded on PR #1035. No installation is implied by source tests. Preserve the existing app until the exact final signed bundle verifies. Live ChatGPT consent/model discovery/provider execution and installed native acceptance are separate requirements.

Graph refresh uses the immutable repository wrapper. Structural extraction completed; semantic freshness remains unverified following the guarded semantic failure. Existing Swift graph-parser warnings are not compiler diagnoses.
