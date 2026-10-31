# PR #993 — Unified Timeline: named versions, undo this change, compare with now and version export

- Branch: `claude/history-browser-integration` → `main`
- PR: https://github.com/lopugit/thingtime/pull/993
- Mission: integrate the history-browser design concepts (PR #947, ported in PR #989) completely into the shipped Unified Timeline; slice 2 of the plan in `TODO/claude-todo/56-unified-thing-history-and-timeline-browser.md`, after slice B (notes, PR #991). `api.timeline` 1.18.0.

## What landed

- Shared contract `remix/app/timeline/versionNames.ts` (record, `name-version` command, result parser) and server `api/utils/timeline/versionNames.ts`: one `timeline-version-name` control Thing per owner/event, `nameRevision` CAS, effect-event receipts per name/rename/clear, tombstoned clears so revisions stay monotonic, bounded page reads inside the page byte budget.
- `mode: 'undo'` in `publishedVersion.ts` and `createVersionService` (injectable `entries/nodes/snapshot/deleted/recorded/live` seams; base = after, incoming = before, canonical already-reverted check; capture operation `restore` + label `Undid change`).
- `api/utils/timeline/exportVersion.ts` + GET `export=1` (dispatched before the plain `eventId` read; ancestor parts pre-check; `timeline.export` limit).
- Client: `nameStore.ts` (in-memory cache with clear tombstones), `sync.ts` page/entry names + effect application, `useThingTimeline().names`, `useApi` gates (`nameVersion`, `exportVersion`, undo first in the `version` gate), `browserModel` name/system lines/search, `changes.ts` page option.
- UI: `TimelineVersionNameEditor.tsx` strip per Versions row, `TimelineCompareNow.tsx`, `timelineExportDownload.ts`, `timelineVersionControls.ts`, undo flow and labels in `TimelineVersionActions.tsx` / `TimelineVersionComparison.tsx` / `TimelinePublishedPagePreview.tsx`, 📌 badges in every look.
- Docs: `docs/unified-timeline.md` dated section, feature map, `TESTING.md`, `remix/CHANGELOG.md`; `test:timeline` glob now includes `app/components/Timeline/*.test.ts`.

## Verification record

- `test:timeline` 238/238 · `test:api-capabilities` 93/93 · `test:schemas` 264/264 · full `test:unit` chain exit 0 · `test:timeline:versions` PASS against the worktree dev server on the disposable `timeline-rs` replica (Nitro port).
- Lint: 0 errors on changed files. Ratchet: 91 vs baseline 89, both above-baseline errors outside this PR.
- Browser (in-app pane, `timeline-rs` stack): name → 📌 badge + notice, rename returns focus; Undo this change → Review undo → apply → `Undid change` row with its system line; Compare with now → Then/Now + toggle; Export → notice with the sanitized filename; 375px sheet rows wrap without overflow.

## Review round (five lenses, two skeptics per finding; 12 confirmed, all fixed)

- `canView` fences every `timeline-` kind (the version-name kind was readable by its owner through generic reads).
- Export checks a compact version's saved-ancestor parts reference before any part document is read; the route's 413 carries `code`.
- Cleared names keep a tombstone (server record without payload; client cache timestamp) so a stale rename from an earlier life and an older naming effect paged later cannot resurrect or overwrite a name; the HTTP script and unit tests cover monotonic revisions.
- Compare with now lets a new selection start its own comparison while an earlier one is in flight; the name editor returns focus after the operation ends; strip buttons announce the version name; the version-action spinner sits on the pressed button; docs no longer claim Compare with now is gated on 1.18.0.

## Debugging notes

- The HTTP script first asserted a cleared name exported as null for a version it had just re-named; the server was right, the script expectation was stale.
- `createVersionService` had no injectable read seams; adding them (no behaviour change) is what made in-process undo tests possible.
- `TimelineConnection` grew a `names` member, which also required the unowned `storageScope.test.ts` and `relatedHistory.test.ts` fixtures to be updated.

## Remaining acceptance work

- A real explanation/undo on production should be spot-checked after deploy (local server has no Lopu model; undo was exercised on the test replica).
- Next slices: server-side search + day counts, History settings and entry points, Frames as-of rendering and lane labels, retention/clear.
