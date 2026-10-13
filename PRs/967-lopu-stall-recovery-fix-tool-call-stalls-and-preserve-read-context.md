# PR #967 — Fix Lopu tool-call stalls and preserve checkpoint read context

Branch: `codex/lopu-stall-recovery` → `main`.

## Problem and behavior

The reported Claude reply emitted `json tt-tool` fences, which the host displayed
as ordinary text before marking the reply complete. Separately, a 23,744-character
Component read crossed a hosted checkpoint; only tool summaries survived, so Lopu
started reading from offset zero again.

The text parser now accepts complete `json tt-tool` and `tt-tool json` variants,
including arbitrarily split labels. Arguments must be complete JSON; backticks
inside JSON strings remain data. Native providers that print a call receive at
most two corrective hops. Displayed JSON never executes directly. Repeated
failure remains a recoverable error rather than false completion; pending
confirmation and Stop retain their existing barriers.

Successful paged `get_thing` calls accumulate up to 16 locators: Thing ID, crystal
pointer, offset and exact revision. The protected, quota-accounted assistant
message writer stores only these locators in private BinData. Public messages and
historical receipts do not expose them. The next request loads the newest owned
first-party assistant's locators, then rereads pages through canonical `get_thing`
authorization, four at a time. Changed or inaccessible resources discard their
whole page group; no results, confirmation grants, Actions or writes are replayed.
Read restoration expires after 24 hours and decodes at most 20 KiB of metadata.

The loop also retains Action failure `data` when feeding the next provider hop,
so run IDs and recovery instructions introduced in PR #964 are actually usable.
Reply capability is **1.19.1**, a compatible correction.

## Validation

- Full `npm --prefix remix run test:unit` passed, including parser and actual
  `get_thing` authorization/revision regressions.
- 60 provider transport tests passed, including a 23,744-character JSON read
  across six hosted checkpoints followed by one edit, without model rereads.
- Both capability suites passed (91 tests); changed production files pass lint.
- Production build and Vercel output validator passed. Raw `tsc --noEmit` retains
  91 existing repository diagnostics; none concern changed production files.
- Opt-in disposable loopback replica/API QA passed seven lossless pages through
  real protected message persistence/reload, byte-exact restoration, private
  projection and foreign-viewer refusal. Existing browser/server Action, Ask/Full,
  signed confirmation, session revocation and idempotent-upsert checks also pass.
- Security review: public reply input cannot supply locators; message membership
  is checked on storage/load; every restoration uses current viewer authority and
  the original revision; only `get_thing` is reconstructable. No new routes,
  collections, indexes, credentials or permissions are introduced.

Graphify AST outputs are refreshed with the final source. Hosted CI, exact-head
merge and production rollout are checked after the final push. The user also
explicitly requested continuation of the affected live chat after deployment.
That live acceptance is separate from local synthetic provider tests.
