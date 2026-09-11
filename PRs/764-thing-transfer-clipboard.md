# PR 764 — portable Thing transfer

## Scope and current checkpoint — 2026-09-11

The requested outcome is broad export/import, actual browser/OS clipboard
Copy/Cut, and downloadable files/ZIPs that can be imported again. This PR is
still in progress; the Things clipboard/download checkpoint is not completion
of that scope.

- Versioned portable JSON carries content, kinds, extended data, folder and
  target relationships, but never account ownership or authorization envelopes.
- ZIP archives contain a manifest plus numbered, size- and SHA-256-checked
  file entries. Traversal paths, missing/unexpected entries and inflated size
  violations fail before any import. Collection drains folder pagination and
  deduplicates bounded dependency graphs.
- `api.things-export` 1.0.0 performs fresh authorized reads, canonicalizes app
  aliases, preserves gallery placement and returns a bounded plan. File bytes
  are separately reauthorized, size-checked and hashed before delivery.
- `api.things-import` 1.0.0 creates new private caller-owned Things through
  ordinary schema, permission and quota checks. IDs and executable references
  are remapped server-side; partial failures clean only newly created records.
  Managed account/control kinds require their dedicated workflows.
- Things now has an Import dialog with JSON/ZIP validation, destination choice,
  explicit file-upload and private-copy confirmation, normal upload retries,
  and account-keyed teardown. Import POSTs are never automatically retried.
  A lost response requires checking Things before another attempt.
- Things Copy/Cut write portable content to the OS clipboard. Paste imports
  private copies unless matching in-memory cut intent belongs to the same
  account/session; clipboard text can never request a destructive move.
  Download offers ZIP/JSON and folder/dependency/file inclusion choices.

## Evidence

- Algorithm coverage (2026-09-11): owner-only full snapshots preserve exact
  weights and training statistics, including legacy records. Public preview
  access alone never exports weights. The dedicated algorithm writer validates
  bounded plain data, creates fresh quota-accounted private/unshared records,
  and does not activate or train them. Its import return avoids fallible author
  label lookup after commit so mixed-import cleanup always receives the minted
  ID. AlgorithmManager exposes the common transfer controls and privacy warning.
  Transfer contracts are 1.4.0. Validator and transfer-service tests cover exact
  data, private projection, rejected authority and dedicated rollback.

- Theme coverage (2026-09-11): dedicated owned/public theme reads (including
  legacy records), content-only name/tokens export, fresh private imports via
  saveTheme, and dedicated rollback. Active theme selection is never changed.
  Generic protected-kind policy remains intact. Invalid theme structure and
  extra fields are refused rather than silently discarded. Theme Studio now
  exposes the shared transfer controls and refreshes My themes after import.
  Transfer contracts/client minimums are 1.3.0. Desktop JSON and mobile ZIP
  download/file-picker round trips preserved resolved tokens and private read
  denial. The first test cleanup used the wrong route; its three exact temporary
  fixtures were removed through `/themes/delete` before rerunning.
  Feed algorithms and stored-file upload-approved-account acceptance remain
  outstanding; this is not a claim of completion of the broad request.

- Stored-file annotation correction (2026-09-11): export plans and portable
  bundles now retain optional title, multiline description and filenamePreview
  for uploaded files as well as links. Import/export clients negotiate 1.2.0.
  After ready-upload ownership checks, normal annotation accounting writes run
  with a server-only fresh-unbound-post fence inside their transaction. A
  concurrent bind therefore cannot annotate an existing gallery. Imported
  content does not set detected types, moderation, file bytes or ownership.
  Actual stored-file upload acceptance still needs an upload-approved account.
  Validation: 97 Things tests, 178 attachment tests (plus six media-cache
  tests) and 39 capability tests pass. Full build and Vercel output verification
  pass; the built manifest advertises import/export 1.2.0 without requiring
  database access. Targeted lint has no errors and one intentional unsafe-URL
  test warning. Full typecheck retains baseline diagnostics, none in changed
  transfer/attachment implementations. The real desktop JSON/mobile ZIP linked
  gallery regression also passes through the stricter annotation transaction.

- Linked-gallery extension (2026-09-11): import/export 1.1.0 adds optional
  `links` and complete `attachmentOrder` to the version-1 portable envelope.
  URLs and bounded owner annotations remain metadata, never fetched bytes.
  Imports call the same link/annotation writers as ordinary gallery creation,
  bind fresh records in source order and retain quota/private ownership checks.
  That existing link path deliberately requires no stored-upload approval.
  Stored files still use normal uploads; flagged linked exports fail closed.
  Failure cleans only new unbound drafts (bound records use Thing cascade).
  JSON can include links independently of stored files; the download dialog
  exposes a separate link-inclusion choice. Actual Chrome desktop JSON and mobile
  ZIP downloads were imported through the file picker: both copies retained two
  links, multiline annotations, filename previews and order after source deletion.
  Anonymous reads returned 404. Dialog bounds and button hit-tests passed; all
  disposable fixture Things were removed through normal API cascade deletion.
  This is linked-record proof, not offline external bytes or stored-upload proof.
- Linked checkpoint validation: 96 Things tests and 39 capability tests pass;
  attachment suite passes including admin/owner flagged-link export denial and
  unchanged no-redirect content behavior. Full Vite/embed/Nitro build plus
  Vercel output verification pass. The built server manifest returns import and
  export 1.1.0; this isolated manifest smoke has no database configuration and
  does not claim database health. Targeted lint has zero errors (one intentional
  unsafe-URL test warning); full typecheck retains baseline diagnostics, with
  none in the changed transfer or attachment implementation files.

- Nested value menus now offer typed portable clipboard Copy/Cut, JSON/ZIP
  Download and reviewed Import file. Their one-data-Thing envelope can also
  enter the normal private Things importer; local import unwraps only explicit
  value envelopes and directs saved app/file imports to My Things. Ordinary
  JSON is accepted with the same value validation. Non-JSON values, unsafe
  keys, cycles, accessors, hidden properties and lossy arrays fail explicitly.
  Delayed Cut checks the copied value/context again before invoking deletion.
- Top-level deletion uses the provider's explicit root boundary instead of
  its ignored empty path; direct nested paths delete their leaf key rather
  than the entire dotted label. Transfer confirmations use one layer above
  stacked Lopu notifications, keeping mobile controls unobstructed.
- Value helper and read-only menu regressions bring the focused Things suite
  to 91 passing tests. Chrome has verified real nested-value JSON/ZIP downloads
  and file-picker reimports, type-preserving Copy/Cut/Paste and desktop/mobile
  bounds plus notification-obstruction hit-tests. Full-project typecheck has
  baseline failures; no diagnostics remain in the new value helper/dialog or
  modified context-menu entry point. Existing Thingtime hook warnings remain.
- Direct nested-property and array-element Cut were checked through their own
  editor URLs; siblings and array shape remained intact. The downloaded value
  ZIP was imported through My Things into a fresh private data Thing, read back
  through the normal API, then deleted through that same API. Other value
  fixtures existed only in the isolated browser's local tree.
- Shared Transfer controls now cover Thing details, component-family pages,
  public webpages and the Builder inspector. An isolated Chrome fixture checked
  real ZIP downloads and OS clipboard envelopes plus Import dialog bounds and
  hit-testing on all four surfaces at 1280px and 390px. Dialogs and portaled
  menus explicitly layer above the Builder inspector. Fixtures were deleted
  through the ordinary Things API after each run; no source user data changed.
- Current focused Things suite: 87 passing tests. All seven changed frontend
  files pass targeted lint. These results do not prove stored-file acceptance.
- Follow-up: import 1.0.1 reconstructs persisted component instance contexts
  from canonical transfer content and reuses the fork media bindings. Saved
  defaults, distinct page instances, CSS media and a second re-import retain
  fresh attachment references without rewriting labels or template arguments.
  Seven import tests pass, including service-level ready-upload checks.
- Real file-bearing browser acceptance was attempted with a generated PNG ZIP.
  The disposable fixture account was refused by the normal upload approval
  gate before any Thing import. The UI displayed the refusal and kept Import
  disabled. This is not stored-file round-trip proof; no gate was bypassed.
- 85 Things tests and 38 API capability tests passed, covering content, ZIP bytes,
  malformed/oversized envelopes, authorization, rollback and cancellation.
- Real local API integration imported six disposable folder/schema/data/action/
  component/page Things, exported and re-imported them, verified private
  ownership and remapped references, ran both copied actions, denied anonymous
  export, then deleted all twelve copies.
- An isolated Chrome session using a disposable local fixture account checked
  invalid input, JSON file selection, desktop/mobile dialog bounds, a real
  two-Thing import and the refreshed folder listing. Real clipboard Copy/Paste,
  downloaded JSON and ZIP file-picker re-imports, and same-session Cut/Paste
  moving the original folder all passed. Eight disposable Things were cleaned
  after the complete browser run. Desktop/mobile export screenshots and bounds
  were inspected; existing mobile global-nav crowding remains outside these dialogs.
- Full Vite/embed/Nitro build and Vercel-output verification passed. The built
  well-known capability response advertises export/import 1.0.0. A separate
  attempted `/api/v1/capabilities` probe was not a valid manifest endpoint;
  it is not counted as a passing smoke.
- Targeted new-file lint passed. ThingsPage retains five existing hook warnings.
  Full typecheck still has unrelated baseline errors; the focused output has
  no errors in changed transfer/import/upload files after corrections.

## Remaining acceptance

Complete all file/gallery forms: linked galleries currently fail explicitly
rather than silently disappearing. Split-template imported media now has its
rebinding adapter, but real stored-file UI proof needs an upload-enabled test
account. Builder/component/detail and generic nested-value controls are wired.
Verify remaining stored file bytes through
the real import UI, account transitions, partial failures and desktop/mobile
dynamic states. Verify current-head CI and preview independently of local tests.

Local stack: http://127.0.0.1:12280 (Nitro 12282, HMR 12281).
No verified Tailscale/Funnel URL is available for this worktree.
