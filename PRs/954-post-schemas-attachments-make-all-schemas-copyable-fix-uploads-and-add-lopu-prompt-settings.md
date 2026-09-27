# PR #954 — Public schemas, uploads and Lopu instructions

Branch: `codex/post-schemas-attachments` · base: `develop`

## Behavior

All 95 built-in registry definitions, including root and collection shapes, are
projected into ordinary public `thingtime: ['schema']` Things owned by `system`.
The reserved `schema-<id>` identity prevents squatting. The same projection and
normal Schema validator power API copies, the schema browser and Lopu. Copies
are independent owner-controlled snapshots with `forkOf`, nested constraints
and render templates. Open records and opaque objects become bounded `json`
fields instead of vanishing from a copied Thing/Component/Post/Schema. The
80-node field budget accommodates the full root shape plus extensions; nested
fields still count toward the limit. Reserved data-tagging names and
the wildcard catch-all remain outside the user field namespace. Native kinds
still enforce their specialized validation and authorization.

The Post schema includes a reusable title/image/text render template. Users can
copy any visible schema from its detail or browse card, add fields, and create
Things from their own schema. Lopu can inspect a schema, extend it, and validate
values before creating native or schema-backed content. Unknown schema names
now fail instead of creating a misleading schema-less record.

Two independent failures blocked Builder's Use file action: the holder Post had
`type: 'post'` rather than a valid Post type, and its client retry ID began with
reserved `component-`. Both use canonical write validation now. The existing
private holder, upload retry identity, commit lifecycle and form fields remain.

Lopu's `save_attachment` copies owned chat/file/recording/post/comment bytes to
an independent owner-private file through the normal quota, multipart-copy,
moderation and deletion lifecycle. The request-scoped identity prevents repeat
copies after lost receipts. Folder placement uses the existing transactional
managed-content writer, avoiding a fresh-file moderation/version race. A
partial placement failure returns the already-saved file instead of pretending
nothing happened. Provider media context contains only authorized attachment
IDs and stable content URLs; object keys and signed storage URLs stay private.

Settings → Lopu exposes shared base guidance and a private instruction list with
add/edit/remove and per-entry enabled checkboxes. Settings → Admin edits shared
public guidance. Revisions protect against concurrent saves; background reads
preserve both the draft and the revision it was based on. Personal text is
stored in the existing protected account metadata, excluded from public profiles,
and cached only in account-scoped browser memory. Reads do not cache positive
server prompt results across users or turns.

Chat, standard voice, direct voice, musings and recording analysis compose the
current base and enabled personal instructions. Web and iOS direct voice require
voice-session 1.2.0 and send the server-composed session instructions. Existing
sessions use their initial instructions until restarted. Canned messages do not
invoke an AI prompt. Tool authorization and Confirm cards are server-enforced.

## Validation

- Twelve targeted test commands pass: schemas, migrations, components,
  attachments, Lopu, chat streaming, musing streaming, Lopu UI, API capabilities,
  actions, Things and AI model routing. The action suite retains its existing
  single skipped test. CI exposed an old source assertion that required the
  static musing prompt; it now checks the composed prompt while retaining its
  provider/model-routing assertions. Runtime provider tests cover composition.
- Full production build and Vercel output verification pass. Targeted TS/TSX lint
  passes with existing warnings. Existing MTS tests use the TypeScript parser
  and ES2020 environment explicitly because the current repo override excludes
  that extension; those checks also pass with warnings.
- A clean archive of the original base and the changed branch both report the
  same 91 TypeScript diagnostics, with no added diagnostic signatures. The
  repository's recorded ratchet baseline is 89; it was not increased.
- Isolated loopback MongoDB replica set and local object-storage adapter:
  all 95 system Schema Things read anonymously; real PNG upload into a chat;
  Lopu copies it, files it, assigns its URL to a Product, returns the same file
  on retry, then reads byte-identical content after deleting the original chat.
  Anonymous content access fails. No production data or live S3 was used.
- In-app browser at desktop and 390px: add two instructions, disable one, save,
  reload, edit the admin base and read the changed public prompt. No horizontal
  overflow. Copy Post through the real form, retain JSON/nested fields and
  render, add `brand`, publish the owned Browser Product schema. Select a real
  PNG, Use file, Save product, open the saved Thing and see its image rendered;
  the returned record includes both URL and attachment ID.
- XcodeGen plus iOS simulator build succeeds. Installed and launched on iPhone
  17 / iOS 27.0, with built Info.plist explicitly pointing to the isolated
  loopback app. The changed native voice code compiles; no real provider voice
  conversation or physical-device test is claimed.

Local evidence is saved under `/tmp/thingtime-post-attachments-qa/`:
`lopu-settings-mobile.png`, `lopu-admin-desktop.png`,
`upload-success-desktop.png`, `upload-success-mobile.png`, and
`product-with-upload-mobile.png`. Synthetic fixture IDs and credentials are in
ignored `.fixtures` files, not this PR. The iOS build is at
`/tmp/thingtime-post-attachments-qa/ios-build/Build/Products/Debug-iphonesimulator/Thingtime.app`.
The installed simulator bundle was verified running from its own container.

## Rollout

Deploy the application, then dry-run/run the existing fenced
`backfill-user-storage-accounting` migration to seed/refresh system schemas
before reconciling accounting. Running the raw seed outside that fence is
refused once ledgers are live. No new secret/environment setting is required;
README documents fork-safe admin, storage and isolated acceptance setup.

This PR targets develop. Production deployment, migration execution and a
main promotion have not been performed. Local storage tests do not establish
live S3 behavior or model-provider inference. Existing protected-kind write
paths remain required even when their public shape has been copied.

Graph maintenance: the local semantic proxy health endpoint timed out. The
required structural/code graph is refreshed through the repository wrapper;
changed Markdown is documented here but not newly semantically indexed.
