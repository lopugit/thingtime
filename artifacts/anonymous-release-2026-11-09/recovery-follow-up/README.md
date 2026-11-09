# Bound-file and linked-child History recovery

## Final recovery checks — 10 November 2026

The reviewed source now passes actual recovery in both isolated Chromium and
the separate macOS development app. The [final build proof](final-build-proof.json)
pins the five runtime source hashes and renderer `021173e8`; the earlier
`build-proof.json` below identifies the superseded `5314793` package.

The [browser run](final-browser.json) restores a private image post, its image
comment and both attachments after acknowledged server cascade deletion. It
preserves the Thing identities, restores images across offline reload, obtains
fresh remote file receipts, verifies exact PNG bytes and refuses guest reads.
The plain-Thing recovery run also passed. Review controls were exercised at
1440, 390 and 320 pixels. All task browser resources were removed.

The [macOS development run](final-native.json) independently passed the same
create, sync, offline delete, server deletion, offline recovery, reload and
reconnect sequence. It verified original authors/relationships, new attachment
IDs, exact bytes and private ACLs. The older conflicted fixture correctly refused
recovery pending account deletion review and remains separate. Only the distinct
Thingtime development app was refreshed; the stable application was unchanged.

Three defects exposed by browser testing and review are fixed: image recovery
now supplies validated attachment context to the ordinary content validator;
a dispatched/uncertain old file DELETE requires a fresh upload identity; fresh
recovery clears the deleted account file ID. Streaming checksum verification
runs before the IndexedDB transaction, then the transaction rechecks the scoped
binary revision and digest. Corruption, changed bytes, missing proof or retired
identity cannot produce a partial restore. Protected kinds retain their writers.

[Full workspace checks](final-workspace-checks.json): 947 passed, 113 explicit
environment/browser skips, plus five offline-shell passes. The 32 focused
recovery cases are included in that workspace count. [Static checks](final-static-checks.json):
raw TypeScript and its zero-error ratchet pass; full lint has zero errors and
359 warnings. Production source hashes stayed unchanged through build/checks.
Test-only fixture corrections after the build are recorded separately and do
not change the compiled assets. The published recovery checkpoint `4492bc7e` passed API, build/typecheck/unit,
native compilation and CodeQL checks. Later evidence-only heads retain their
own CI state; [checkpoint checks](../final-preview/published-checkpoint-checks.json).

The [final identity fixture batch](../final-isolation/README.md) and the
[matching hosted provider preflight](../final-provider/README.md) have now passed.
The new [deployed preview](../final-preview/README.md) also passed clean native
render/download with the same renderer hash. Remaining delivery is final-head
CI, actual connected-host artifact delivery and separately authorized release.
The superseded provider candidate was retired; only the accepted matching
snapshot is retained. Native evidence is development-app acceptance, not a
stable production installation.

## Earlier reviewed build

Implementation and local checks are complete for the source hashes in
[the build proof](build-proof.json). The real-browser failures from this build motivated the fixes above;
this earlier receipt is not final recovery acceptance or production activation.

The account adapter now retains recoverable parent-deletion file bytes inside
its scoped, charged device History. It restores ordinary linked children and
exact local file identities in the same transaction as the parent and History.
After acknowledged remote deletion it obtains fresh file upload receipts before
recreating the parent and children. Explicit file removal keeps its cleanup
behavior. Existing device-workspace clearing removes retained History bytes;
there is no new per-version purge control.

Frozen or refused deletion, changed children, incomplete retention, stale file
callbacks and retired scopes cannot partially recover content. A removed file
is not resurrected from an older parent binding. Pending pre-upgrade deletions
retain their original target semantics. Late parent write acknowledgements and
reviewed keep-local deletion preserve the new recovery metadata; accepting the
remote version clears it. Device-only Action execution receipts are excluded
from ordinary child recovery and are never replayed.

New post deletions record complete local file coverage atomically. An older
post deletion without that evidence cannot reliably distinguish text-only
content from purged unsent attachments. It now reports the missing retention
proof instead of silently returning a partial recovery. Data already discarded
by an older version cannot be recreated from metadata alone. Protected
Theme/Algorithm content remains behind its dedicated writers.

Validation at this checkpoint:

- 68 focused recovery, bound-media, deletion and timeline regressions passed.
- The final workspace suite passed 934 tests, with 112 explicit opt-in browser
  skips; the five offline-shell checks passed separately.
- Raw TypeScript and the zero-baseline ratchet passed. Full lint passed with zero errors and 359 warnings; the canonical Vercel
  build completed with unchanged source hashes.
- The complete test:unit command passed an earlier recovery iteration. The
  final reviewed changes were covered by the focused and workspace commands
  above; exact-head CI remains a separate gate after the commit is pushed.

The new renderer hash differs from the prior provider snapshot. That snapshot
must not be activated for this build. A matching image/snapshot and fresh
provider preflight are required after the final browser checks. Hosted MCP
artifact delivery and production release remain unverified and subject to the
pending task-specific release approval.

## Final-bundle browser slices

[Bound-media evidence](bound-media.json): both opt-in scenarios passed against
the referenced build. Discard-before-submit produced a private text-only post
with no upload. The post/comment lifecycle verified exact image bytes, bindings,
private reads, offline removal, immutable deletion retry, parent/descendant
remote deletion, and 1440/390/320 layouts. The passing run did not exercise a
reviewed conflict; an earlier fixture run retained the expected refusal from a
test-initiated remote file-order change.

[Custom-plane Theme History evidence](theme-custom-history.json): the real
selected custom database kept Home History separate. Offline UI version export,
import, title change, folder move and deletion passed, with two exported versions
and exactly one create, two update and one delete History event. The deleted
version retained content and placement. All three layouts scrolled to the bottom
without horizontal overflow. The open detail retired on a second custom-plane
switch. No offline mutation requests or page errors were observed. The focused
History/import and reader-lease tests passed separately (6/6).

Both disposable browser/backend fixtures were stopped. Final recovery acceptance is recorded above. The refreshed provider snapshot
and hosted delivery remain separate gates.
