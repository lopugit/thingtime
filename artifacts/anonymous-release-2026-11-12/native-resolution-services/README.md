# Native resolution service checkpoint

Source base: `8efe93a53cccb087985d3b545cb6c448a9885693`, containing main
`f2538e19257bcfdf35ba050e7b187c94ea2252c0`. New changes are attributed by the
verification source inventories rather than an invented clean-commit build.

This checkpoint advances the shared canonical services required for complete
offline page resolution:

- Workspace root, role, moderation and linked-customer decisions are shared
  across providers. Native setup uses real registered SQLite identities and
  canonical workspace/content writers. Read windows are complete. A separate
  synthetic fetched-candidate test covers more than 5,000 records; it is not
  storage or API acceptance.
- External audiences use protected local account-link and content-source
  metadata, with no credentials, provider refresh or network fetch. Relationship
  records in these tests are explicitly isolated SQLite unit fixtures, not
  end-to-end external-account setup. Actual inherited/page authorization is
  exercised against them.
- Authorization memo epochs are isolated by request/provider/transaction and
  invalidated on mutation, transaction exit and before after-commit work. Returned
  Viewer snapshots cannot overwrite another context's permissions.
- Trusted held content uses canonical creation, accounting and Timeline receipts.
  Native attachment requires the actual content session and fresh hold identity.
  Direct input cannot mint protected holds. Quota fault injection is labeled
  separately from the canonical lifecycle acceptance.
- Workspace clients negotiate `api.builder-workspaces` 1.2.0, which removes the
  former record ceiling. Native workspace HTTP is still unavailable because
  delegated writes and Maps vault capabilities are incomplete.

## Verification

There are **25 passing command results** across the two recorded batches, with
3,484 reported test passes, nine skips and no test failures. These are execution
totals, not a count of distinct cases: corrected tests are rerun deliberately.
The initial batch retained a failed typecheck with six test-only diagnostics.
Removing unreachable error branches and using the repository-compatible own-key
check corrected them without changing compiler settings or runtime source.

The final checks pass TypeScript, the zero-error ratchet, full lint (zero errors,
376 warnings), canonical packaged build and integrity verification, and actual
MongoDB/SQLite HTTP restart fixtures. The built Mongo manifests both report
workspace 1.2.0. The native SQLite manifests register that version while correctly
withholding its incomplete HTTP capability. SQLite still reports generic Things
unsupported and queued mail undelivered. Both fixture processes/profiles close
and clean up through their task-owned lifecycle.

Each batch retained unchanged source throughout its checks. Between batches,
only six explicitly listed test/fixture files changed; the passed runtime suites
were reused rather than rerun. See [summary and reuse attribution](verification-summary.json),
[initial commands and corrected failure](verification/verification.json), and
[remaining gates](verification-final/verification.json). Exact source inventories
accompany both receipts. Original log bytes are retained when normalization was
needed; see [the normalization receipt](log-normalization.json).

Compiled Nitro SHA-256:
`6add91618637e6b62040e8e849359eaf7f684e09e3bef07ea20f610454600f5d`.
This payload has desktop fixture acceptance; the previous iOS compilation is a
different checkpoint, and no new iOS runtime acceptance is claimed here.

The updated progress document is checked in isolated Chromium at 1440, 390 and
320 CSS-pixel widths, including full scrolling, filters, search and navigation.
Its screenshots are tracker evidence only, not native Builder UI evidence.

Graphify is refreshed structurally through the repository wrapper. Complete new
semantic documentation indexing is not claimed: the earlier bounded proxy
recovery exhausted its retry budget, and the shared service remains unchanged.
Existing extraction warnings outside this changed TypeScript scope remain
separate from the passing compiler and runtime checks.

## What this does not establish

Generic native Things, catalog and full webpage-resolve HTTP remain gated.
Full compiled GET/POST resolution, app/PAT namespaces, managed mutations/cascades,
creation coordinators, indexed search, actual offline Builder editing/save/reload,
iOS Keychain/runtime launch, physical-device acceptance and canonical connected
agent-host artifacts still require their own proof. A service test or successful
compile does not establish those capabilities.

The existing release hold remains: no main merge, production deployment, stable
application replacement, existing account-data mutation or shared proxy changes.
