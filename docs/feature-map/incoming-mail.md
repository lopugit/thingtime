# Incoming mail

`/mail` and `/email` mount `components/Mail/MailPage.tsx`; Email settings is shared
by the settings page and popup through `EmailSettings.tsx`. `mail/model.ts` is
the shared account/folder/message/proxy contract, validation, projection and
pure UI merge. `mail/useMail.ts` coordinates explicit cloud/local sync and
`mail/localStore.ts` retains individually encrypted IndexedDB records with a
revision fence. The pairing token and device credentials stay encrypted in device storage; API relay explicitly transmits credentials for each request without storing them server-side.

`routes/api/v1/mail/_mail.tsx` is a full-session, expected-owner, same-origin,
private/no-store boundary. It refuses service, temporary, scoped and internal
Action identities; `server/routes/api/[...].ts` refuses ordinary origin fallback; the desktop shell may use its explicitly selected HTTPS account endpoint.
`api/utils/mail/store.ts` owns home-plane accounted transactions, encrypted
protected Things, idempotent settings and sync-versus-delete fences. Reuse the
shared schema/owner/createdAt/shareId index; no new indexes or collections.

`api/utils/mail/provider.ts`, `network.ts` and `pop3.ts` implement read-only IMAP
and POP3 over verified TLS, pinned public DNS and bounded responses. The local
loopback adapter is `scripts/mail-connector.mts`; it never exposes arbitrary
socket operations. Proxy definitions reference folders and cannot mutate mail.
The route/import map/docs register `api.mail` 1.2.0 and `api.mail-sync` 1.0.0 in both manifests and the
client negotiates it. Kinds are protected and excluded from generic reads.

Run `test:mail`, `test:mail:transport`, `test:mail:connector`, `test:mail:storage`, `test:settings` and
`test:api-capabilities`. `test:mail:integration` requires the explicitly
disposable replica in README. Actual provider and browser acceptance remain
separate from synthetic protocol tests; see TESTING's Incoming mail checklist.

The application CSP in `scripts/csp.mjs` permits only the connector's fixed
HTTP loopback origin; production headers and Vite consume the same policy.

`mail/native.ts` negotiates `thingtimeDesktop.mailSyncVersion` 1.x and owns IPC
request IDs and cancellation. `electron/lib/mail-sync.cjs` fences top-level
origin, lifecycle and concurrency, while `electron/scripts/build-mail.mjs`
bundles the existing provider. `mail/client.ts` uses `/api/v1/mail/sync` only
when the saved transport explicitly selects relay. The route shares the full
mail auth boundary but bypasses all mail persistence and vault configuration.
iOS's destination drawer opens Mail; WebView uses the relay with its own session.
Run Electron's `test/mail-sync.test.cjs`, `test:mail`, `test:mail:transport`, `test:mail:relay`,
`test:api-capabilities` (including private desktop proxy tests), native builds
and the live browser/native checks in TESTING.md.

Gmail uses `api/utils/mail/google.ts` for fixed-endpoint, bounded Gmail
API calls and refresh tokens; `googleOAuth.ts` owns ten-minute PKCE flows in the
existing TTL `authOtps` collection. Only the initiating live browser session can
confirm the verified address. Callback completion alone never links an account.
Private grants use the existing encrypted/accounted mail-account; projections
must whitelist public fields. `google-relay` reads a saved grant but persists no
messages, while `sync` retains the existing cloud revision/deletion fence.
`GoogleMailConnect.tsx` provides the shared browser/native consent controls.
`/api/v1/mail/google/callback` is registered in both manifests and the import map,
and never follows origin fallback. Google client config is an exact-origin map
in the existing admin vault; see README for fork-safe setup and verification.
The iOS WKUIDelegate opens explicit new-window HTTP(S) links in the system browser.

`googleActions.ts` and `mail/googleModel.ts` define Gmail modify/label/draft/send
adapters and strict recipient/header validation. `google-action` takes a stable
writeId, account revision and validated mutation. `store.ts` admits a protected
accounted `mail-operation` child before provider I/O; complete retries reuse the
result, uncertain ones never replay, and known pre-dispatch failures remain
editable. Account leases/content revisions serialize mutations and reject stale
sync writes. `google-drafts` pages Google drafts without saving their bodies.
`GmailWorkspace`, `GmailMessageActions` and `GmailComposer` share those APIs;
compose drafts use separate encrypted rows in the existing mail IndexedDB store,
with per-draft revisions and owner/origin isolation. No new collection is added.

## Anonymous and offline workspaces

`mail/useMailWorkspace.ts` keys both normal Mail surfaces by trusted root identity;
`mail/workspace.client.ts` selects the anonymous or account partition and gates
all cookie-bearing mail clients before capability negotiation. `mail/localStore.ts`
keeps the existing encrypted rows and canonical records, scopes account mail to
its API origin/owner (home plane), and uses workspace leases through crypto and
transaction completion. No account API, new route or remote capability is added.

`useMail` opens local state first; cloud refresh is independent and cannot replace
newer device edits. Anonymous setup selects native sync or the existing fixed
paired connector, never relay/cloud/Gmail. Existing device-only account settings
remain locally editable while offline. Cloud-backed account settings still use
remote writes and require a future durable local queue. No automatic anonymous
adoption is allowed. Same-origin old account keys remain readable; unproven
legacy desktop-origin caches are not reassigned to a selected server.

`mail/workspace.test.ts` exercises real IndexedDB/encryption with synthetic data:
account/origin partitions, more than 2,000 retained messages, crypto/transaction
retirement and rejection before any fetch. The store processes encryption in
batches without a retention count ceiling. Keep the native UI/provider checks in
TESTING open until exercised in an isolated browser/native session.
