# PR #888 — Run service workspaces live on pages and in the editor

Branch `claude/task-completion-43f339` → `main`.
PR: https://github.com/lopugit/thingtime/pull/888

Continues the Jim’s Mowing franchise work from PRs #871, #876 and #879. The
owner reported that the HQ page (`/p/jims-mowing-hq`, page `159e97a4…`)
showed only “Open this component in an interactive page to use its service
workspace.” on the live page, in the builder and on mobile, and asked for the
app to render normally without a dedicated URL.

## Root cause

The service workspace is inserted as an **html block**
(`BlockInsertMenu` → `<tt-service-workspace rootId=… name=…>`). The
“safe previews” gate added with the service-workspace merge (`e81c19c19`)
reads `NativeControlsEnabled`, which only `LiveTemplate` (component blocks)
provided. Html blocks rendered through `RichHtmlView` with the context at its
default `false`, so the app stayed inert on every surface — the production
page included. A read-only check with the owner’s session confirmed the prod
page is exactly one html block carrying the workspace tag.

## Changes

- `WebpageBlocksRenderer.tsx`: html blocks provide `NativeControlsEnabled`
  = `interactive` (owner/shared/seeded viewer with the page runtime on), in
  every runtime mode. Edit/Layout render the app with a “Live app preview —
  switch to View, or open the page, to use it” hint (the seamless editor’s
  edit click gate still selects the block instead of driving the app); View
  and the live page run it. Builder mode (`interactive` false), the classic
  canvas, component-library previews and feed embeds keep the placeholder.
  `hasNativeApp` / `NATIVE_APP_TAGS` exported for the hint and tests.
- `HtmlThingRenderer.tsx`: `InteractiveWorkspace` takes the workspace name and
  renders a named, explanatory placeholder.
- `ServiceWorkspace.tsx` + new `serviceNavigation.ts`: a bounded back trail
  (`pushTrail`/`popTrail`) so Back returns to the previous record; new child
  records (`serviceParentRecordId`) keep their parent open; deleting from a
  list keeps the page; the unsaved-page `bindPage` failure becomes a “Save this
  page to connect it” notice. `ServiceRecordEditor.tsx` reports kind/values/
  created to the `saved` callback.
- README (builder service workspaces) and TESTING.md regression bullets.

## Validation (2026-09-22)

- New `webpageBlocksNativeApp.test.ts` renders `WebpageBlocksRenderer` with a
  minimal DOM shim for `htmlToNode` (Node has no `DOMParser`): live page runs
  the app (Suspense fallback present), inert surfaces keep the named
  placeholder and never mount the loader, Edit/Layout show the hint, View and
  the live page do not, Builder mode stays inert, hint only for native-app
  html. New `serviceNavigation.test.ts`; `HtmlThingRenderer.test.ts` updated.
- `test:webpages` 110 pass, `test:service-workspaces` 11 pass, `test:editorjs`
  90 pass, `lint:files` clean, typecheck ratchet at the 89-error baseline,
  `build:client` ok.
- Local stack `tt-wt-task-completion-43f339-11200` (Vite 11200, Nitro 11202)
  with a throwaway account, an isolated QA workspace and
  `THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR`: builder Edit mode shows the live
  app + hint (clicks select the block), View mode and the plain `/p/<id>` page
  run it; Create workspace; customers; properties with the Places error path
  and manual entry; customer↔property links; jobs from a property; visits with
  native date/time and crew; status buttons; time logs (auto minutes); usage
  logs (battery %, vehicle, fuel, travel); comments; media upload → gallery →
  thumbnail/banner; planner week/day, reorder and date moves; equipment; team
  roles; Trash delete/restore; Setup; Map no-key state; 390px layout without
  horizontal overflow. Employee/Customer visibility and write refusals were
  checked through the API.
- Local-only notes: the worktree stack needed `ensure-bcrypt` after the first
  start and after `build:client` (Napi crash of the Nitro process; the Vite
  child had to be killed before `npm run web-pms`). Setting
  `THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN` to the Nitro port breaks browser
  uploads under CSP — keep only the storage directory for browser QA.

## Remaining / follow-ups

- Google Places autocomplete needs **Places API (New)** enabled in the Google
  Cloud project that owns `GOOGLE_PLACES_API_KEY`; keys are in the owner’s
  Vault and the app reports the exact reason. Manual address entry works.
- Production acceptance after merge: open `/p/jims-mowing-hq` as the owner
  and on mobile; the workspace must render without `?mode=visit`.
