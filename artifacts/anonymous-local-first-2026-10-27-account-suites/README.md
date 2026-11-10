# Account suite integration evidence — 27 October 2026

This is local, isolated acceptance of uncommitted suite integration based on
`9f24113dd883b450e9d3086753b6cfd027d175a8`. It is not CI, deployed gateway or
installed-device acceptance. The product package was built with secret-bearing
local environment files excluded and restored afterward. `source.json` identifies
the initial source and package hashes. Later attempts have their own source and
package receipts. Product repairs between attempts are recorded separately.

The complete normal UI flow now passes in
[retry9](../anonymous-local-first-2026-10-27-account-suites-r9/README.md), including
canonical adoption, two explicit reviewed choices, preserved original private
version recovery, saved example execution and the original Component/page URLs
after cold reload. That final evidence supersedes the pending UI status below;
the earlier failed runs remain retained.

## Passed

- Full client and server build.
- Typecheck: 91 existing diagnostics, no added or removed normalized diagnostics.
- Timeline tests: 265 passed. Webpage tests: 187 passed, 5 skipped.
- Local-workspace tests: 886 passed, 101 skipped; offline-shell tests: 4 passed.
- Real API fixture against a disposable Mongo replica set: concurrent transactional
  installs, exact canonical mapping/readback, committed-receipt replay after later
  edits, only-missing customization, redaction, origin/actor/data-plane/bundle
  guards, legacy compatibility, cross-account privacy, custom plane accounting,
  quota rollback and retry after refusal. See `suites/suite-install-result.json`.
- In browser retry 3, normal offline Install in two tabs, Run example, save and
  cold reload of an editable component, rename and reload, and zero offline
  account mutation requests all passed before the reconnect fixture failed.
  Its desktop/390px/320px captures are in
  `../anonymous-local-first-2026-10-27-account-suites-r3/suites-ui/`.

## Earlier failed attempts

Initial attempts had not accepted canonical adoption or conflict recovery.
They stopped during setup: a hardcoded data-plane fence
received 409; the next attempt did not obtain an authenticated root user through
its API request context. Source inspection confirmed the canonical flat
`RootLoaderData.user.id` contract. Retry 3 used browser-native same-origin fetch,
validated the exact synthetic actor and data plane, and reached the normal UI.
It stopped when the fixture's reconnect transition left `navigator.onLine` false.
These failures and their bounded cleanup are retained in the original and retry
artifact directories; they must not be presented as successful end-to-end runs.

Retry5 exposed a real old-family-ID lookup bug, fixed before retry6. Retry6
exposed a test control client that still shared the offline context; retry7 used
an independently signed-in context and exposed a real preserved-version recovery
bug for settled frozen writes. Retry8 stopped during menu ownership initialization.
Retry9 verifies stable normal edit readiness before disconnecting and then passes
the real offline path and repaired recovery without bypassing disabled controls.

Wider Character/identity transitions, managed adapters, deployed gateway and
installed-device matrices remain separate unfinished work.

All runtimes used task-owned, network-none, read-only containers without host
mounts or published ports, with Chromium's sandbox enabled. Browser and backend
hostname/direct-IP/IPv6/redirect egress denial was verified. Each attempt released
its owned runtime and recorded an empty remaining-container result. No existing
account, public content or production data was changed. The shared LLM proxy
service and credential were left unchanged.
