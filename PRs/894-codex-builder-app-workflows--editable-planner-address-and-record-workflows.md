# PR 894: Editable planner, address, and record workflows

The opt-in authoring factory now produces 46 ordinary saved Action and Component Things. Planner navigation, address search, forms, record links and media grouping remain editable JSON in those Things. No additional app kind or API contract is introduced.

## Changes

- Day/week planning, date navigation, employee and status filtering retain their query context.
- Authorized record references show readable linked titles. Equipment choices distinguish batteries and vehicles; viewer/non-admin forms respect the returned editing role.
- Before/After/Gallery sections retain unlabelled existing files and media pagination.
- Address search is an explicit saved browser Action. Selection updates text/place ID atomically; manual edits clear a stale place ID. Local drafts survive source refreshes and save links require the matching successful save Action.
- Reusable framework controls add safe scope-path fallbacks, bounded local-state patch/clear operations and optional picker-state binding.
- Source results and action receipts cannot cross record/query or viewer/page/sharing boundaries. Persistent results retain one bounded cache slot per block and require the same source/input binding; old unbound caches are ignored. In-flight responses from a previous identity are ignored.

## Validation

- 71 focused tests passed, including cache binding isolation, bounded state operations, malformed/inherited input rejection, role gates, planner controls and address selection.
- Typecheck remains at the existing 89-error baseline. Changed-file lint passed. Full Nitro/Vercel build and output verification passed.
- All 46 definitions were persisted through the disposable local API. Chrome desktop and 375px checks covered planner controls, picker filtering, related-record navigation, address edits and grouped media.
- API readback proved synthetic address selection stored both fields and a manual edit cleared the stale place ID. The synthetic lookup Action was restored exactly afterward; actual Google provider success is not claimed.
- With a five-second network delay, following a property link removed the old job's edit/archive controls before the new record arrived. Normal networking was restored.
- Initial exact-branch Gitleaks scan found no leaks. Exact final-head CI, provider checks and deployment state are recorded in the PR.

## Conversion boundary

This remains an opt-in composition factory and isolated fixture. Production page content, records and ACLs are unchanged. Collaborator execution, thumbnail/banner selection, remaining planner/linked-record flows, scalable selection and live HQ migration remain part of the active conversion work. The existing native runtime stays available for compatibility until that migration is complete.

Local: http://localhost:17120/p/qa-editable-builder-page. Tailscale/Funnel is unavailable: the installed shim targets a missing application binary. Preview: https://pr-894.previews.dev.thingtime.com (deployment status is tracked on the PR).
