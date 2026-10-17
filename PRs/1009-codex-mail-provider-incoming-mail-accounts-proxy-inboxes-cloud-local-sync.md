# PR #1009 — Incoming mail accounts, proxy inboxes and cloud/local sync

[PR](https://github.com/lopugit/thingtime/pull/1009) · branch `codex/mail-provider` · target `main` (explicitly authorized on 2026-10-17)

## Behavior

Settings → Email supports multiple IMAP and POP3 accounts, both protocols per
account, mandatory TLS/STARTTLS, and independent cloud/local checkboxes. `/mail`
and `/email` show accounts, folders, All inboxes and named proxy views selecting
folders across accounts. The proxy operation is purely a view: provider mail is
never copied, moved, marked read or deleted.

Cloud records are private, encrypted, protected Things on the home data plane,
using existing accounted transactions and indexes. Account revisions, immutable
write IDs and deletion fences cover retries and stale completions. Passwords
never appear in reads or origin fallback. Browser records share the same model,
use per-record AES-GCM and a non-exportable device key, and refuse stale writers.
Account-scoped first paint and tab notifications retain cached views across
navigation; local credentials are checked against current server settings.

Ordinary web pages cannot open POP3/IMAP TCP connections. Local sync therefore
uses the included origin/token-paired loopback connector. It runs the same
protocol adapter, receives credentials only from the local browser and does not
store them in Thingtime cloud. The shared production/dev CSP allows only its
fixed HTTP origin. Public-address DNS pinning, certificate checks, strict secure
ports, parser limits, bounded pages and deadlines constrain provider requests.

## Verification — 2026-10-17

- `test:mail`: 14/14; encrypted storage, stale writer refusal, projections,
  membership selection, destination-change credential fencing and route checks.
- `test:settings`: 38/38; `test:api-capabilities`: 94/94; `test:nav`: 17/17;
  `test:vercel-config`: 15/15 including the fixed loopback CSP destination.
- `test:mail:transport`: real verified TLS sockets with synthetic IMAP/POP3
  servers; read-only EXAMINE/FETCH, UIDL/LIST/RETR, dot unstuffing, successful
  STLS upgrade and downgrade refusal before credentials are sent.
- `test:mail:connector`: real loopback HTTP preflight, origin/token checks,
  local opt-out and versioned synthetic mail response.
- `test:mail:integration`: real API registration/session and disposable replica;
  encrypted account CRUD, retry identity, stale revision, private generic Thing
  projections, foreign folder refusal, cloud opt-out and deletion tombstones.
- `test:mail:storage`: production route over real HTTP/authenticated sessions and
  real replica transactions, with a controllable synthetic provider boundary.
  Confirms encrypted folder/message storage, repeat-sync convergence, proxy
  ownership and a controlled delete-versus-in-flight-sync race.
- `test:schemas`: 269/269 after adding the four encrypted mail kinds to the
  pinned public-projection table; this fixes the initial CI schema failures.
- Production client and Nitro server builds pass. Raw TypeScript reports existing
  diagnostics outside changed files, so the repository typecheck is not clean.
  Focused lint: zero errors, five warnings (control-character validation and
  hook lifecycle dependency analysis).
- Live browser: created local IMAP and POP3 accounts; paired synthetic connector;
  All inboxes displayed four source messages; proxy including an extra IMAP
  folder displayed six; editing the proxy left the two source-folder messages
  intact. Reload retained accounts, messages and proxy. Offline emulation kept
  cached search and message reading functional in the loaded app.
- Desktop 1280 px and mobile 375 px: mailbox, message detail and both-protocol
  settings checked. Mobile document scroll width equals viewport width (375 px).
  App-password values are not echoed on edit; POP3 STARTTLS selects port 110.
  Script-looking mail remains plain text.

Browser QA found and fixed the connector CSP omission. A fresh document
navigation is needed after a CSP header change; a cached document can retain
its previous policy. A transient local Node worker crash interrupted initial QA;
the worktree's managed PM2 stack was restarted and HTTP/browser checks resumed.

## Boundaries and remaining acceptance

- Sync is explicit, in ten-message provider pages; it is not background polling.
- Device reading cache: 2,000 messages, 12,000 text characters per message,
  512 KiB downloaded source cap. Partial messages are labeled. Attachments are
  counted but not downloaded; sending and OAuth are not implemented.
- Secure standard ports and public DNS only. Internal mail servers/custom ports
  are unsupported. Some providers require OAuth instead of app passwords.
- Views with local-only folders stay device-local. An existing cloud proxy
  cannot be converted in place to include a device-only account; create a new
  proxy for that combination.
- Real-provider credentials were not used. Provider-specific acceptance,
  HTTPS-to-loopback permission/mixed-content behavior, and offline cold-launch
  of the entire app remain unverified. Synthetic fixtures do not prove these.
- Global `TESTING.md` remains a reusable unchecked checklist; the bullets above
  state which parts were actually exercised in this run.
- Local QA uses `127.0.0.1:13760` and disposable Mongo replica `mail-qa-rs` on
  `127.0.0.1:20437`. No public Funnel was enabled for this test database. The
  installed Tailscale CLI shim points to a missing Tailscale app, so Funnel
  status cannot be verified. Production verification is performed after the authorized main merge.
- Graphify refresh/semantic extraction results are recorded in the PR's final
  validation update. Missing semantic extraction must not be treated as indexed.
