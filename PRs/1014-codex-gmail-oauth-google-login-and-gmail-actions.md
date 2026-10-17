# PR #1014 — Google login and Gmail actions

Gmail connections now use Google consent instead of an app password. The shared
Mail surface supports reading, read/unread, archive, Trash/restore, custom label
creation/rename/apply/remove, encrypted device drafts, Gmail draft save/load,
and explicit recipient review followed by sending. Gmail authorization uses
`gmail.modify`; this is mailbox access, separate from Thingtime sign-in.

## Boundaries

- OAuth uses PKCE, opaque one-use state, a ten-minute challenge, exact origin,
  and the initiating live browser session. The external callback never signs
  into Thingtime or links the mailbox; the initiating app confirms the verified
  email address before finishing. Cancellation and expiry discard pending data.
- Refresh authorization stays encrypted in the owner vault. Device-only is the
  default message storage choice; API relay does not require a desktop helper.
  The grant is still saved server-side and this is disclosed before connection.
- Protected, accounted `mail-operation` Things admit each immutable action
  before provider I/O. Completed receipts can be read again; uncertain sends
  cannot be replayed. A crash/lost provider result requires checking Gmail,
  rather than promising automatic reconciliation or exactly-once delivery.
- Parent revision/content fences serialize cache updates and reject stale sync.
  Each cache transaction also requires its own mutation lease and renews it,
  so a previous action cannot overwrite a newer action after lease expiry.
- Compose is plain text. Rich HTML/attachment drafts remain read-only here with
  Open Gmail available. No permanent-delete operation is exposed. Gmail edits
  outside Thingtime can race after the last message-ID check; Google does not
  offer an atomic compare-and-send contract through these endpoints.
- The iOS WKUIDelegate opens explicitly activated HTTP(S) new-window links in
  the system browser, retaining the original signed-in app for completion.

## Verification — 2026-10-17

- Mail 34/34; API capabilities 95/95; schema projections/protection 270/270;
  settings 39/39; Electron 107/107.
- Synthetic TLS IMAP/POP3 transport checks passed.
- Disposable replica-set integration used real login, owner vault, route
  handling, and accounted transactions with a synthetic provider. Verified
  callback/finish idempotence, grant redaction, device-only no-persistence,
  settings preserving the grant, deletion fencing, completed-action retries,
  changed-payload refusal, uncertain-send no replay, and controlled sync races
  against both deletion and a Gmail mutation.
- Browser checks verified the Google connection entry, actionable missing
  configuration message, readonly connected address, plaintext composer,
  encrypted draft recovery after reload, and no horizontal overflow at 390px.
  Browser automation subsequently disconnected; additional desktop action
  interaction and external Google consent were not claimed as verified.
- Client and bundled Nitro builds passed. The iOS simulator build passed with
  explicit local web URL, verified Info.plist, installation, and app launch.
  Real system-browser consent handoff still needs configured Google credentials.
- Full TypeScript has 91 existing diagnostics outside changed mail files;
  the ratchet passes with a warning against its 89-error baseline. Scoped lint
  has no errors; existing model/useMail warnings remain.

## Setup and native delivery

README documents the exact-origin `google-mail-oauth` admin vault secret,
Google web client/callback setup, `gmail.modify` consent verification, and the
restricted-data requirements. No live Google grant or real email send was used
in validation. Configure and verify these on the deployment before launch.

Concurrent native builds exposed a shared bundle-stage collision during
signing. `electron/README.md` now documents an isolated, supported cache root
per worktree, including the allowed parent directory. The existing Mac app was
observed running another active task's `codex/mobile-file-sync` build. Its
installation is preserved; replacing it and testing the installed Gmail build
requires coordination with that task. An iOS simulator build is not a physical
device or TestFlight release.

Local QA uses the isolated worktree at `http://localhost:13760` (API 13762).
Tailscale/Funnel was unavailable on this host; no public local tunnel was
claimed. Preview and CI status are linked from the PR and can change after
this source checkpoint.
