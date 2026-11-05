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
Each native read is at most 256 KiB; this is a processing chunk, not a total-size limit. Image previews use a bounded 640-pixel JPEG,
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

## No arbitrary sharing input limits

The sharing flow has no product ceilings for text, rich-text block counts,
file selections, filenames, annotations, tags, linked URLs or Thing references.
Data values retain type, cycle and storage-integrity validation. Post and
discussion readback preserve the full authorized attachment list. Input, storage
and rendering must not silently trim content to an older product maximum.

Bounded upload parts, thumbnail previews, pagination and read chunks manage
resources without capping the original selection. Account storage accounting,
request framing and actual operating-system/storage constraints remain in force.
A refused or interrupted operation preserves the native original for recovery.
Standalone portable archive transfer still has its separate existing total
budgets; this sharing flow uploads files through the ordinary file transport
and does not invoke that archive importer. Its metadata roundtrip accepts the
long values introduced here.

## Contracts and recovery

The native `thingtimeShare` bridge negotiates version 1.0.0 and exact origin /
request identity before reading content. Only the main frame at that origin may
call it. File reads use opaque IDs within that batch, never arbitrary paths.
Submission state is bound to the account, origin, destination and operation.
Local source retention, an uploaded draft, a committed server object and a native
acknowledgement are separate states. Interrupted or uncertain operations retain
originals and reconcile their existing identities before further mutation.

Message send requires `api.chats-messages` 1.4.0; edit requires
`api.chats-messages-edit` 1.2.0. These remove old product text/item ceilings.
Private chat archive import negotiates `api.things-import` 1.13.0 so long
message text also survives export and restoration. Saving long text requires
`api.things` 1.51.0; Data strings have no product character ceiling.
The compatible update and schema contracts are 1.20.0 and 1.2.0 respectively.
Empty originals in Post and Message negotiate `api.attachment-uploads` 1.10.0
and `api.attachment-upload-complete` 1.7.0. Their ready zero-part upload is
verified through the ordinary storage lifecycle and retains draft expiry.
Authenticated shared-content JSON uses incremental fatal UTF-8 decoding after
authorization and rate admission, without an application byte ceiling. Numeric
budgets remain on unrelated control requests. The complete JSON value still
materializes in runtime memory; upstream transport and storage constraints must
produce explicit errors rather than truncation. Annotation, external-link and file
metadata negotiate `api.attachment-annotate` 1.3.0, `api.attachment-link` 1.2.0
and `api.files` 1.12.0. Multipart signing pages every part; completion sends only
`uploadId` and the server enumerates all parts.
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

Final transport acceptance on the sanitized built server verifies all nine
changed route families above their former JSON budgets, exact long-value
readbacks, uploadId-only zero-byte completion and anonymous/private refusals.
Both API and UI-origin manifests expose the expected minors. This evidence uses
only disposable accounts, replica-set storage and local attachment bytes.
