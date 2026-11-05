# Signed-in bundled suite installation audit — 2026-10-27

Signed-in `installSuiteForWorkspace` still requires the remote suite-install endpoint, unlike anonymous atomic local installation. An offline account cannot install a bundled suite. This remains incomplete.

A direct AccountThingSync atomic-write candidate was rejected: an incomplete account device cache cannot identify same-key suite definitions already owned in the cloud, so immediate ordinary creates could duplicate them. Untested candidate code is retained only in ignored `tmp/continuation/account-suite-candidate/`; it is not implementation or test coverage.

Source evidence: `components/Builder/installSuite.ts`, `local-workspace/suites.ts`, `local-workspace/accountSync.ts`, `api/utils/webpages/suites.ts`, and `schemas/suiteInstallation.ts` under `remix/app`. The canonical server installer performs sequential key lookup/create/update and already returns every schema, Component, Action, data and page ID. AccountThingSync remembers exact IDs only; generic identity adoption is absent.

Safe continuation requires a durable account/origin/plane-scoped suite intent that materializes locally and holds part uploads until a canonical server receipt is reconciled. Preserve authoritative IDs, private ownership, later local edits, expected revisions, History, source leases and canonical references; atomically prevent same-key server races. A preflight key lookup alone is insufficient. Verify incomplete-cache installs, full graph reconnect, concurrent installs, cold reload, rollback and identity retirement through focused regressions and the normal isolated Install-button path.

No candidate tests/build/browser checks were run while the independent native vault timing restriction was active.
