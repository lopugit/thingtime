# PR #991 — Unified Timeline contextual messages: notes, Lopu explanations and system lines

- Branch: `claude/history-browser-integration` → `main`
- PR: https://github.com/lopugit/thingtime/pull/991
- Mission: integrate the history-browser design concepts (PR #947, ported in PR #989) completely into the shipped Unified Timeline; slice B of the plan in `TODO/claude-todo/56-unified-thing-history-and-timeline-browser.md`.

## What landed

- Shared contract `remix/app/timeline/notes.ts`: `TimelineNote`, `add-note` / `explain-change` / `remove-note` commands, `note-<operationId>` retry identity, result validation, `HistoryNoteView`.
- Server `api/utils/timeline/notes.ts` + `explain.ts`: `timeline-note` protected relational Things (secure BinData, `targetId` = event Thing, ≤ 8 per event, storage-metered through `thingStorageSizeBytes` via `timelineNoteBytes`, exact refunds on removal), page/entry reads carry `notes`, `timeline.explain` rate limit, full-account gate, Lopu explanation from the recorded change only through `generateAiCompletion` (503 and nothing stored when no model answers). `api.timeline` 1.17.0.
- Client `timeline/noteStore.ts`, IndexedDB v6 (`notes`, `noteCommands`), sync drain after events/branches, `useThingTimeline().notes`, `api.v1.timeline.note`.
- UI `components/Timeline/TimelineMessages.tsx`: bubbles in List/Cards/Frames, Messages toggle (`messages=off`), Changes / Message / Versions tabs in the detail column and the mobile sheet, composer, Ask Lopu, Remove, retry/dismiss.
- Docs: `docs/unified-timeline.md` (Contextual notes section), `docs/timeline-design-integration.md`, feature maps, `TESTING.md`, `remix/CHANGELOG.md`.

## Verification record

- `test:timeline` 198/198 · `test:api-capabilities` 93/93 · `test:timeline:notes` PASS against a worktree dev server on the disposable `timeline-rs` replica (Nitro port; `explain-change` answered 503 locally with no Lopu model configured, nothing stored).
- Lint: 0 errors on changed files (10 pre-existing warnings on untouched lines). Typecheck ratchet: 91 vs baseline 89, both above-baseline errors in files this PR does not touch.
- Browser (in-app pane, `timeline-rs` stack): add note → bubble in List and Cards, pending → synced pill, toggle hides bubbles, Ask Lopu refusal, reload persistence, Remove; 375px bottom sheet with tabs and Versions list, no overflow; 1280px side column.

## Debugging notes

- Storage metering: note text lives only in `secure`, so the ordinary crystal/extended/tags projection would meter notes as free; `timelineNoteBytes` in `api/utils/timeline/envelope.ts` adds the record bytes and fails closed on a malformed envelope (`noteStorage.test.ts`).
- `--tt-border-grad` from the concept does not exist in the theme tokens; the Lopu bubble uses `--tt-gradient-rainbow` with a fallback.
- The repository Graphify wrapper rebuilds a snapshot even for a read-only `scripts/graphify query` when the source fingerprint changed; superseded snapshots are pruned by the wrapper and committed as deletions.
- The in-app Browser pane scales a 1280px emulation into an 800px frame, so `ref` clicks computed from a stale frame can miss; DOM probes through the JavaScript tool were used to select rows and confirm state.

## Remaining acceptance work

- A stored Lopu explanation was only exercised by unit tests (no model configured on the local test server); production verification after merge should ask Lopu on a synced change.
- Next slices: named/pinned versions and export, Undo this change, Compare with now, server-side search/day counts, History settings and entry points, Frames as-of rendering, named-branch lane labels/elbows.
