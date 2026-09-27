# PR #960 — Lossless Lopu inspection and actionable category errors

The live Action run completed an eight-record equipment migration and saved the
page change removing the duplicate gear band. A fresh read-only browser visit
verified eight rows (seven batteries and one tool), and inspected a record's
serial, model and specifications. The original records were retained by Lopu.
No messages were sent to the observed chat and its access setting was unchanged.

During the run, the default `get_thing` response omitted deep form fields and
suggested repeating the same read. The workspace rejected lower-case category
labels without returning the allowed values, causing repeated reads and probes.

## Changes

- Optional `path`, `offset` and `revision` on `get_thing` select lossless JSON
  text pages from the already-authorized public crystal. JSON Pointer escaping
  and own-property traversal are supported; storage metadata is unreachable.
- Each page rechecks access and hashes its selected JSON. A changed revision
  refuses continuation. Pages preserve Unicode and remain intact through the
  provider's existing result bounds; default reads explain omissions.
- Generic workspace select validation reports exact accepted values while
  retaining strict validation. No equipment-specific mapping is hard-coded.
- Both discovery manifests publish the additive reply contract 1.18.0.

## Validation

- `test:lopu`, `test:lopu-chat-streaming`, `test:lopu-ui`, `test:schemas`, `test:actions`,
  `test:service-workspaces`, and `test:api-capabilities` passed.
- Focused regressions cover large/deep forms, long text/arrays, escaped paths,
  malformed cursors, stale revisions, per-page access revocation and the real
  provider transport. Workspace tests reject incorrect case and accept the
  specified choice.
- Production-shaped `npm run build` passed, including Nitro Workflow packaging
  and `verify:vercel-output`. Focused lint passed. The typecheck ratchet warns
  about repository diagnostics outside the modified implementation; its baseline
  was not changed.
- Live browser checks confirmed the existing Action access fix and migration
  outcome. The follow-up inspection/error behavior is verified by local tests
  and build; those checks alone do not claim the new code is deployed.

The AST graph snapshot was refreshed with its matching manifest; semantic
extraction for changed prose is not claimed by this AST-only update.

Main integration preserves PR #954 prompt settings and schema/attachment tools.
Its 1.17.0 contract is retained; this additive inspection contract is 1.18.0.
Both test groups remain in the Lopu runner.
