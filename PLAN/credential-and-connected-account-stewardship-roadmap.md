# Credential and connected-account stewardship roadmap

**Status:** Proposed; owner and qualified privacy/security review required

**Grounded:** 2026-10-18, Australia/Melbourne

**Evidence:** [Credential and connected-account stewardship baseline](../NOTES/credential-and-connected-account-stewardship-baseline.md)

**Execution epic:** [TODO 57 — Credential and connected-account stewardship](../TODO/claude-todo/57-credential-and-connected-account-stewardship.md)

## Outcome

Make every credential-bearing connection and imported secret understandable,
scoped, revocable, recoverable, and deletable without conflating provider
authorization, Thingtime storage, local cache, transient relay, imported source
data, or external side effects.

## Guardrails

- Preserve provider-, platform-, and data-class-specific boundaries; do not
  force mail OAuth, IMAP credentials, desktop-native credentials, and imported
  password archives into one abstraction without evidence.
- Use least privilege, exact-origin consent, current session/owner authority,
  and explicit review before consequential external actions.
- Never report provider revocation, local purge, cloud deletion, export
  completeness, or message delivery unless that exact outcome was verified.
- Keep message bodies and credentials out of analytics, ordinary logs, support
  traces, Graphify, and public artifacts.
- No new permissions, production migration, automatic polling, or irreversible
  provider action is authorized by this roadmap.

## M0 — Inventory the data and authority map

- Map each credential, token, imported archive, attachment, cache, draft, and
  message class to its owner, origin, storage location, encryption boundary,
  readers/writers, retention, and deletion path.
- Distinguish user session, provider grant, local/native credential, API relay,
  and imported secret; record what each can authorize and how it expires.
- Review disconnect, OAuth revoke, last-link retirement, logout, device loss,
  account closure, and import deletion independently.
- **Gate:** every data class and side effect has an evidence owner and explicit
  unknowns; no design assumes that unlink means revoke or purge.

## M1 — Define lifecycle vocabulary and receipts

- Specify connected, consent pending, authorized, expired, reconnect needed,
  disconnected, provider-revoked, locally purged, cloud-retained, deleted,
  export-ready, and outcome-unknown states.
- Define user-visible consequences before disconnect, revoke, delete, and export;
  keep retries idempotent and irreversible actions separately confirmed.
- Separate local cache purge from cloud record deletion and provider-side
  revocation, with per-account outcome receipts and partial-failure handling.
- **Gate:** copy and state tables accurately describe failure and recovery; a
  provider outage never turns uncertainty into a success claim.

## M2 — Rehearse narrow synthetic journeys

- Use synthetic IMAP/POP and Google test accounts plus a synthetic 1PUX archive;
  never use a personal inbox or vault.
- Exercise connect, least-scope consent, explicit sync, safe send review where
  applicable, unlink one of multiple account links, last-link retirement,
  provider revoke, local purge, export, and restore as separate cases.
- Inject token expiry/rotation, stale sync, duplicate action, transient provider
  response, interrupted multipart transfer, offline cache, and partial cleanup.
- **Gate:** zero cross-account disclosure, stale overwrite, duplicate external
  effect, credential leakage, or false completion receipt; cleanup is evidenced.

## M3 — Ship only a reviewed, bounded improvement

- Select one observed gap and one provider/data class; document current behavior,
  compatibility, migration, rollback, support, and accessibility before coding.
- Add tests at the real API/provider boundary with synthetic data and verify
  encryption and public projections independently.
- Recheck all affected account, data, and capability contracts; qualify launch
  claims to the exact tested platform and flow.
- **Gate:** owner approval, qualified security/privacy review, verified cleanup,
  and no unresolved high-severity regression. Otherwise stop at documentation.

## Stop conditions

Stop if data ownership is ambiguous, a test would touch a personal provider,
revocation cannot be distinguished from deletion, a retry can duplicate a
consequential effect, secret material enters ordinary telemetry, or a cleanup
failure cannot be surfaced and remedied. Escalate the decision; do not weaken the
gate to preserve schedule.
