# Incoming mail

`/mail` and `/email` mount `components/Mail/MailPage.tsx`; Email settings is shared
by the settings page and popup through `EmailSettings.tsx`. `mail/model.ts` is
the shared account/folder/message/proxy contract, validation, projection and
pure UI merge. `mail/useMail.ts` coordinates explicit cloud/local sync and
`mail/localStore.ts` retains individually encrypted IndexedDB records with a
revision fence. The pairing token and local credentials stay in device storage.

`routes/api/v1/mail/_mail.tsx` is a full-session, expected-owner, same-origin,
private/no-store boundary. It refuses service, temporary, scoped and internal
Action identities; `server/routes/api/[...].ts` refuses origin fallback.
`api/utils/mail/store.ts` owns home-plane accounted transactions, encrypted
protected Things, idempotent settings and sync-versus-delete fences. Reuse the
shared schema/owner/createdAt/shareId index; no new indexes or collections.

`api/utils/mail/provider.ts`, `network.ts` and `pop3.ts` implement read-only IMAP
and POP3 over verified TLS, pinned public DNS and bounded responses. The local
loopback adapter is `scripts/mail-connector.mts`; it never exposes arbitrary
socket operations. Proxy definitions reference folders and cannot mutate mail.
The route/import map/docs register `api.mail` 1.0.0 in both manifests and the
client negotiates it. Kinds are protected and excluded from generic reads.

Run `test:mail`, `test:mail:transport`, `test:mail:connector`, `test:mail:storage`, `test:settings` and
`test:api-capabilities`. `test:mail:integration` requires the explicitly
disposable replica in README. Actual provider and browser acceptance remain
separate from synthetic protocol tests; see TESTING's Incoming mail checklist.

The application CSP in `scripts/csp.mjs` permits only the connector's fixed
HTTP loopback origin; production headers and Vite consume the same policy.
