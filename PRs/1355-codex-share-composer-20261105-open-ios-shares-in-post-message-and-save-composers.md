# PR 1355: incoming sharing composers

Sharing into Thingtime now opens New post in the supported iOS Share extension.
The same incoming batch can be composed as a post, sent through ordinary
Messenger, or saved through the existing Things browser with Save here.

## Implementation decisions

- Host the canonical web composer in the extension's WKWebView. Share extensions
  have no documented container-app open operation. Keep normal sign-in in the
  extension store and provide main-app recovery without copying cookies.
- Read original file bytes through bounded native requests. Preserve opaque
  formats, duplicate basenames in different folders, directories, Live Photo
  resources, empty files and whitespace-only text attachments.
- Bind the bridge to the exact request, main-frame origin and account. Persist
  immutable destination/operation/payload claims before mutation. Reconcile exact
  server identities after an interrupted or uncertain result before retrying.
- Reuse PostComposer, Messenger and ThingsPage. The toolbar's buttons, labels,
  icons and pixel accents are independent editable blocks in the ordinary
  settings-document Builder. Context adapters supply registered operations.
  Each composer retains its own upload state. Switching destinations uses the
  destination's normal purpose-bound upload and authorization contract; this
  change does not deduplicate bytes across public and private destinations.
  Future toolbar operations use registered context adapters, with editable
  presentation; saved labels do not grant arbitrary Action execution.
- Remove message text and attachment-count product ceilings. Zero-byte social
  files reuse verified empty-object storage, ownership, quota, lease and draft
  expiry controls. Image-only and recording purposes still validate nonempty
  content. Publish the changes through independently versioned capabilities.

The no-limits follow-up also removes Post/comment/rich-text, filename,
annotation, tag, URL, reference and attachment-projection product ceilings.
Type and cycle validation, authorization, accounting and actual storage
protocol constraints remain enforced. Multipart capacity uses the current
provider contract instead of the stale 5 TiB assumption. Standalone archive
transfer total budgets are separate from incoming sharing and remain outside
this change; its affected metadata roundtrip validators are aligned.

Removing the comment ceiling also required changing feed reads. Comment
windows select small identities and ordering metadata before fetching the
selected bodies in batches. Reaction and vote reads aggregate counts and viewer
state; exact descendant counts traverse bounded keyset pages across the page's
roots. No total thread limit is imposed. Exact counting still requires work
proportional to the visible history; it is not a constant-time operation.

## Validation and evidence boundaries

The native source passes 34 focused tests and a generic simulator build. Eleven
system-share fixtures, the Photos retry and byte verification cover 55 files,
including the JPEG and MOV resources of a Live Photo. Early system-sheet
screenshots capture the transition while the web page loads; loaded-page
acceptance is recorded separately.

The web adapter has 35 focused tests; Messenger and Save have 18. Capability
coverage passes 147 tests after the final nine contract minor bumps and schema coverage 300. Attachment tests cover
purpose ownership, duplicate refusal, empty-object bytes, replay and lease-loss
recovery. Integrated TypeScript and all 300 schema checks pass on the final expanded
source; scoped lint reports zero errors. No warnings occur on changed lines.
The full feed suite passes 101 tests, Messenger passes 70, and the attachment
entry passes 337, including the IncomingShare bridge and viewport regressions.
The follow-up reader has 17 focused passing checks covering window order and
ties, moderation, weighted interactions, overlapping roots and bounded exact
counts.
On the disposable Mongo replica host, the supported import API created 501
comments for an ordinary synthetic account and a normal comment request added
the 502nd. All 502 distinct rows remained reachable through cursor pages. Each
default/new/old/top preview returned 20 correctly ordered rows with exact direct
and total counts. Reaction/viewer state and the older upvoted comment's top
position passed; anonymous access to the private post was refused. This check
used no rate-limit override or direct database fixture writes.

Real browser/API acceptance uses a disposable replica set, explicit synthetic
accounts, local attachment storage and a task-owned browser profile. The native
bridge in those web checks is a fixture, so they do not claim a real iOS
interaction. The matrix covers desktop/mobile scrolling, keyboard space,
Post/Message/Save, long text, more than 25 files, original empty bytes, folder
creation, immutable recovery, identity clearing and independent Builder edits.
Final browser checks passed Post with over 20,000 characters, real PNGs, opaque
and empty files, a 27-row gallery and seven-column layout; native-receipt loss
recovered the exact post without another upload. Message passed 27 attachments
with expanded desktop/mobile scrolling. Save passed actual new-folder creation,
nested navigation, Save here, over 20,000 characters, exact downloaded bytes,
duplicate basenames in distinct paths and a directory-only batch. Identity
changes cleared or refused stale work. Independent toolbar label and icon edits
survived save and reload.

The joined native test published one real Post, preserved exact newline and
Unicode content, received the native acknowledgement and independently read the
same API object. A separate final geometry-only acceptance verified all three
destination buttons, Post submit and the focused editor above the actual iOS
keyboard, stable for six seconds; its full screenshot was inspected. It did not
publish a second Post. Native metadata omits the generated staging container
while preserving actual source folders and original bytes. These simulator
results do not establish physical-device acceptance.

Signed delivery uses the canonical ios-testflight workflow at the final merged
source. Local distribution profiles lack the Share App Group, so development
signing is not used as a release substitute. TestFlight processing and physical
phone acceptance remain separate from the simulator and browser evidence.

Integrating current main exposed a shared FileSync test fixture that referenced
the macOS process transport on iOS. The fixture now selects the real platform
transport and its page counter wraps the common protocol. Current-tree iOS
build-for-testing passes; the existing 10,001-entry/79-page macOS regression
passes unchanged. This repair changes test infrastructure only.

## Runbooks

- [Incoming sharing](../docs/incoming-sharing.md)
- [Manual acceptance matrix](../TESTING.md#incoming-sharing-post-message-and-save)
- Native harness: iOS/scripts/share-acceptance.sh
- Browser/API harness: remix/scripts/incoming-share-acceptance.mjs

## Shared-content transport follow-up

The touched authenticated Post/Data, comments, messages, annotation, upload
metadata, external-link and file metadata routes remove their old JSON byte
budgets. Authorization and rate admission precede incremental fatal UTF-8/JSON
decoding. Unrelated control calls retain their numeric budgets; malformed UTF-8,
cancellation, stale sessions and unauthorized scoped callers are refused.
Multipart completion carries only uploadId, and signing pages until every part
is addressed. The nine additive minors are documented in incoming-sharing.md
and tested against both generated manifests and client requirement maps.
Focused parser/authorization coverage passes 22 tests. Final built real-API
checks above the former body thresholds are recorded before source freeze.
