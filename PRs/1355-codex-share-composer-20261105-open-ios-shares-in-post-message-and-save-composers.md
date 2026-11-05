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
coverage passes 150 tests after the final nine contract minor bumps and schema coverage 304. Attachment tests cover
purpose ownership, duplicate refusal, empty-object bytes, replay and lease-loss
recovery. Integrated TypeScript and all 304 schema checks pass on the final expanded
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
Focused parser/authorization coverage passes 22 tests. The final sanitized built server passed real HTTP checks above the former
768/256/64/32/16 KiB thresholds: Post 810,107 bytes, Data create/update
810,116/810,075, comment 270,055, message send/edit 70,110/70,094, link
20,066, upload 20,138, annotation 20,094 and file commit 34,334. Every write
returned 200 and exact independent reads retained the full values. Zero-byte
completion sent an 83-byte uploadId-only body; the file receipt retained its
34,000-character name and attachment binding. An anonymous 810,044-byte write
returned 401 and the private exact read returned 404. Both built manifest
origins advertised all nine expected minors. No runtime correction was needed.

After merging current main, a real Save-picker smoke created and navigated a
parent and nested folder, verified exact parent IDs, retained the /share route
and confirmed reachable Save here without submitting content. Integrated
TypeScript and the 20 focused merged navigation/Save tests pass.

## Final Graphify coverage

The scoped semantic refresh completed 74 of 117 required slices before the
bounded delivery deadline. Its complete cache entries were retained as validated
immutable variants; no partial graph replaced the active snapshot. The final
source uses the canonical structural refresh with clustering, report and HTML.
Current semantic coverage of the attempted ten Markdown files and later integrations remains incomplete;
the structural output must not be described as full current documentation
indexing. This limitation does not change the application acceptance above.

Final main integration includes scoped local-storage native range signing. The
shared-content body routes, validators and nine client minima are unchanged.
Both capability generators pass 148 tests, and the merged attachment/local
storage regression passes 96 tests, including exact range authority and expiry.

CI exposed three stale discussion-projection assertions for the removed
25-attachment truncation and former aggregate query. The corrected regression
requires all 30 authorized attachments in stored order, one batched authorized
attachment read and no attachment-body aggregation; ACL/moderation and private
metadata refusals remain covered. The focused 31 tests and complete
`test:things` (341 + 31) checks pass, with clean scoped lint. Runtime is unchanged.

The later authored-fields main merge independently used `api.actions-run` 1.41.0
for descriptor expansion. The combined contract is 1.42.0 and the shared-value
client requires it; an authored-only origin cannot falsely satisfy full-value
negotiation. Things 1.51 and update 1.20 remain higher than main's1.50/1.19.
Both manifest generators and a rejection regression cover the combined version.

The authored-fields merge introduced argument-spread traversal that threw
RangeError for a valid 200,000-entry (about 400 KB) Data array. Two canonical helpers
now push iteratively in the same order while preserving cycle handling. The
focused imported Editor/schema/form-ownership/latest-snapshot batch passes 25
tests, including both breadth regressions. Final merged runtime smoke and
exact source typecheck are recorded before publishing the integration.

The first actual broad Data write exposed a separate ordinary Timeline snapshot
node ceiling. It returned500 and the transaction rolled back (the owner's Data
list remained empty); no uncertain write was replayed. The server now copies
complete valid content and routes broad snapshots through existing relational
parts, preserving canonical depth, per-event/per-part envelopes, wire format,
idempotency and exact retained-byte accounting. Full Timeline 247 and capability
150 tests pass; the final source also passes TypeScript. `api.timeline` 1.19.2
and full-content client minima advertise the compatible correction.

Retained 128 MiB/2,048-part per-side and 4,096-part pair windows are safe envelope
headroom above canonical JSON from a valid [16MiB BSON document](https://www.mongodb.com/docs/manual/reference/limits/#bson-documents), not an unavoidable 128 MiB protocol limit.
The read-only extremal NUL-text probe produced 100,662,359 JSON bytes and 1,536
parts (3,072 for a before/after pair), under those processing envelopes.

## Final merged acceptance

The corrected sanitized build passes. One journaled private Data lifecycle
creates/updates 200,000 ordered rows plus 5,242,887 UTF-8 bytes of emoji, Chinese
text and newlines. HTTP bodies of 7,114,482/7,114,438 bytes return 200. Complete
current reads, both historical exports and read-only restore-preview
current/incoming/result match exact text and row hashes; the current state stays
updated. Normal storage admission is unchanged. Both built-origin manifests
advertise all nine write contracts, Action 1.42.0 and Timeline 1.19.2.

The final no-submit browser check passes all 27 files in Post, Message and Save,
27 distinct upload identities for each purpose and no duplicates on return.
Unsent edits survive switching; the saved toolbar label and icon survive exact
private Thing readback and reload, with no new Post uploads. Actual typing
followed immediately by submit captures all 22,122 characters and 27 attachment
IDs, including native pending recovery state. Transport is aborted before the
API write and the exact result remains 404. A positive 20-pixel caret rectangle
(139–159) stays above actions at 171; nested Save folder navigation passes.
All task browser/fixture workers and ports 18430–18433 are cleaned up.

Final source checks include TypeScript, 150 capability/client contracts,
304 schemas, 250 Timeline cases, the focused 87-case complete reader pipeline,
43 imported Editor/style/form/snapshot checks, and the repaired Things suite
(341 + 31). Scoped lint has zero errors; inherited hook/mixed-operator warnings
remain reported in the logs. No new native Post publication was performed.

Graph retention temporarily preserves the exact complete baseline set from the
pinned main integration plus this PR's current output, to avoid generated rename
conflicts during CI. Exactly one snapshot is active; the finite archive count is
recorded in task evidence. The project default and global policy are unchanged. The
final refresh is structural only, with the semantic coverage limitation above.

The final read-only main refresh contained only native-sync fixture and
Electron development-process lifecycle changes. They were integrated without
changing sharing runtime; the focused imported suites pass 16 fixture cases
and 20 local-runtime cases. The accepted UI/Data/native evidence remains
applicable; no additional publication or broad acceptance run was needed.

The subsequent menu-refresh base fix changes only authored-menu lifecycle and
control-activation notification. Sharing callbacks/content negotiation compose
without source conflicts. Focused ownership/form/menu-position/Action-request
checks pass 17 cases, and integrated TypeScript passes. No sharing data path,
Editor layout or capability contract changes, so accepted Data/UI/native
evidence is reused without another publication.
