# Incoming sharing

Sharing from iOS opens **New post** inside the system Share extension. This uses
the same post composer as the web app. The full-width bottom toolbar selects
Post, Message or Save as Thing / file. It never publishes or sends automatically.

The extension hosts a WKWebView because a Share extension has no documented
container-app open operation. It uses ordinary Thingtime sign-in in its own
website data store, without copying app cookies. A pending share can also be
continued from the main app. Both hosts bind the source to the exact selected
origin and account.

## Files and destinations

`ShareItemImporter` preserves representations supplied by the sending app in a
durable App Group batch. Text and URLs prefill the composer; arbitrary binary,
rich data and unknown formats remain attachments. Platform-provided formats
cannot exceed what the source application actually offers. Files retain original
bytes; an image thumbnail is only a preview. Relative directories and Live Photo
resources remain distinct.

The web bridge supplies lazy file sources to the ordinary multipart uploader.
Each native read is at most 256 KiB. Image previews use a bounded 640-pixel JPEG,
not a full-file base64 transfer. Existing upload approval, purpose, quota,
moderation, authorization and exact-version content checks still apply.

Message uses normal Messenger recipient selection, conversation view and Send.
The initial text is admitted once and focus moves to its end. No new message
transport or private-data projection is introduced.

Save embeds the existing Things browser. Folder creation and navigation remain
available; **Save here** stays above the bottom toolbar. Files use the canonical
Files commit/read APIs. Shared text is an editable data Thing with an explicit
embedded render component. Destination and operation identities are retained
before writes, and successful results are read back.

## Reusable interface

`ContextActionToolbar` receives registered action descriptors and current
selection. Its document key selects the persisted layout for each context.
Buttons, labels, icons and Thingtime pixel accents are individual Builder blocks
hosted by SettingsDocumentHost and TransientBlockHost. Layout editing cannot
execute adapter actions. This can support later quick actions without adding
feature-specific native interface code.

## Contracts and recovery

The native `thingtimeShare` bridge negotiates version 1.0.0 and exact origin /
request identity before reading content. Only the main frame at that origin may
call it. File reads use opaque IDs within that batch, never arbitrary paths.
Submission state is bound to the account, origin, destination and operation.
Local source retention, an uploaded draft, a committed server object and a native
acknowledgement are separate states. Interrupted or uncertain operations retain
originals and reconcile their existing identities before further mutation.

Message send requires `api.chats-messages` 1.3.0; edit requires
`api.chats-messages-edit` 1.1.0. These remove old product text/item ceilings.
Private chat archive import negotiates `api.things-import` 1.12.0 so long
message text also survives export and restoration.
Empty originals in Post and Message negotiate `api.attachment-uploads` 1.8.0
and `api.attachment-upload-complete` 1.6.0. Their ready zero-part upload is
verified through the ordinary storage lifecycle and retains draft expiry.
Transport request framing and underlying storage constraints remain separate;
errors must be explicit and must not truncate a selection.

## Development and release

Configure `THINGTIME_WEB_URL` through the existing iOS build setting to select
the test origin. Use a disposable simulator, isolated browser profile and
disposable replica-set backend with synthetic accounts. Do not copy real browser
sessions or point writable test fixtures at production. The local attachment
storage option supports complete file tests without production object storage.

Run the bridge/file-source tests, share-save plan tests, Messenger tests,
attachment service tests and API capability tests. Exercise the real web/API
path and the native system-sheet harness in `iOS/scripts/share-acceptance.sh`.
The full acceptance matrix is in [TESTING.md](../TESTING.md#incoming-sharing-post-message-and-save).
Signed app/TestFlight availability and physical-device acceptance must be
recorded independently before claiming complete delivery.
