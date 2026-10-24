# Local linked media verification

The scoped local adapter supports post/comment URL galleries, mixed URL/stored-file
transfer, normal Attach-by-URL selection, working drafts, independent templates,
post binding, metadata edits and removal. URL rows store canonical metadata only;
import, copying and synchronization never fetch the external URL. A visible
image/video preview may render its original URL through the existing safe sink.

- `import-files-tests.log`: 85/85 passed, zero skips. Covers anonymous mixed
  import/export/reload, current account files/import/export/copy/retention and the
  new URL registration/retry/removal boundary. This run preceded direct URL drafts.
- `direct-draft-tests.log`: 48/48 passed, zero skips on the completed direct path.
  Covers normal anonymous/account URL API without HTTP, draft/template/post receipt
  independence, known receipt refresh, abort during metadata retention, exact
  capability negotiation, malformed receipts, expired selections, lost registration
  and deletion replies, and scoped owner/target/content refusal. Existing API,
  account-draft file and transport regressions run alongside the new cases.
- `lint.log`: zero errors; existing constructor/loop warnings and the intentional
  unsafe-URL refusal fixture warning. Counts above overlap and are not cumulative.
- `copy-fence-tests.log`: 37/37 passed after the final shared export fix. The
  prepared bearer URL plan rechecks every known managed receipt inside destination
  admission; a link removed after preflight cannot be copied while its parent
  survives. `copy-fence-before.log` demonstrates the failing expectation before
  that transaction fence. The independent final review found no remaining issue.
- `bound-projection-tests.log`: 64/64 passed, zero skips, after the integrated
  suite exposed three stale `accountBoundMedia.test.ts` response stubs. Those
  stubs omitted the attachment's `targetId` after parent binding; canonical
  `/things` projects it through `toPublicThings`. The fixture now records binding
  separately from crystal metadata and emits the canonical target. Production
  identity checks were unchanged. `bound-projection-lint.log` has zero errors or
  warnings. This was a test-only repair and does not change the frozen package.
- `mime-metadata-overlap.log`: 55/55 passed, zero skips after the canonical upload
  MIME repair, covering bound-media deletion, linked annotations, file retention
  and bound retention. Independent review found no actionable issue: only the
  matching verified stored-file receipt supplies the account MIME, while later
  MIME changes and owner/target/content substitutions remain refused. This run
  overlaps the earlier service counts and does not include native acceptance.

Account URL registration requires `api.attachment-link` 1.1.0; durable URL removal
requires `api.attachment-delete` 1.8.0. Both reuse `account-files` claims, retries,
request IDs and existing metadata version checks. Bound stored-file annotations
use the same owner/target/immutable-content checks. Generic protected writes remain
refused. Local selections and draft copies require no server capability.

Unfamiliar server-only URL attachments have no retained registration identity and
remain on the canonical online transfer path. Arbitrary managed targets are not
accepted as galleries. Standalone linked roots must be exported through their
owning post; embedded references require that owning post in the bundle.

Native `linkedGallery.browser.test.ts` passed all four scenarios (anonymous/account
mixed ZIP and anonymous/account direct composer/draft/template) on package
`2f0710ac20e67675e56271dd5607a7a32c2e038853e40ebd62dbf40c9e310e59`.
The [native manifest](../linked-gallery/manifest.json) records the exact runs,
test-only selector/synchronization corrections, preserved initial failures and
1440/390/320px evidence. Exact native annotation checks cover URL attachments;
the mixed fixture did not supply stored-byte annotation fields. Stored-byte
annotation coverage above is from focused service regressions. This native
record predates the subsequent canonical upload MIME metadata repair and does
not establish acceptance for that repair.
