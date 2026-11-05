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

## Validation and evidence boundaries

The native source passes 32 focused tests and a generic simulator build. Eleven
system-share fixtures, the Photos retry and byte verification cover 55 files,
including the JPEG and MOV resources of a Live Photo. Early system-sheet
screenshots capture the transition while the web page loads; loaded-page
acceptance is recorded separately.

The web adapter has 35 focused tests; Messenger and Save have 18. Capability
coverage passes 144 tests and schema coverage 300. Attachment tests cover
purpose ownership, duplicate refusal, empty-object bytes, replay and lease-loss
recovery. Integrated TypeScript and all 300 schema checks pass on the final expanded
source; scoped lint reports zero errors. No warnings occur on changed lines.

Real browser/API acceptance uses a disposable replica set, explicit synthetic
accounts, local attachment storage and a task-owned browser profile. The native
bridge in those web checks is a fixture, so they do not claim a real iOS
interaction. The matrix covers desktop/mobile scrolling, keyboard space,
Post/Message/Save, long text, more than 25 files, original empty bytes, folder
creation, immutable recovery, identity clearing and independent Builder edits.
The final acceptance outcome and any limitations remain in the PR status until
verified; no pending path is represented as passing by this note.

Signed delivery uses the canonical ios-testflight workflow at the final merged
source. Local distribution profiles lack the Share App Group, so development
signing is not used as a release substitute. TestFlight processing and physical
phone acceptance remain separate from the simulator and browser evidence.

## Runbooks

- [Incoming sharing](../docs/incoming-sharing.md)
- [Manual acceptance matrix](../TESTING.md#incoming-sharing-post-message-and-save)
- Native harness: iOS/scripts/share-acceptance.sh
- Browser/API harness: remix/scripts/incoming-share-acceptance.mjs
