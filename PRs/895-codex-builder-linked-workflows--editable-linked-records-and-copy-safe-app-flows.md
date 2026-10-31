# PR 895: Editable linked records and copy-safe app flows

The opt-in Builder authoring factory produces 49 saved Component and Action Things. Related lists, navigation, forms, discussions and field updates are editable JSON. The runtime does not import the factory and no additional app kind or API contract is introduced.

## Changes

- Customer/property reverse links, jobs, visits, sub-jobs, time logs and equipment/battery/vehicle usage share the existing authorized snapshot. Related sections page independently in groups of six, without discarding the rest of the records.
- Linked new-record forms preserve parent references while generating a new operation identity. Duplication removes media, ownership, archive and ordering metadata. Existing member usernames stay read-only.
- Visit time totals exclude archived logs. Quick status, thumbnail and banner Actions retain the revision the user saw; they reject stale edits and preserve unrelated values. Upcoming visits exclude completed/cancelled work.
- Comments and nested replies use saved request Actions with stable retry identities. Cursor navigation remains explicit. Media groups contain attachments, and image-selection buttons have an independent fieldset so an expanded upload form cannot leak its inputs into them.
- Relative links and map markers stay inside a copied page. Stable result-operation tags replace comparisons against Action keys that change when copied. The existing copying implementation retains its owned private execution boundary and original authorized data-root reference.

## Validation

- 38 focused composition, map and copying tests pass, including 5,000-record reads/updates, reverse joins, pagination, stale writes, invalid fields, duplicate isolation and copied references/receipts.
- Changed authoring files pass lint. The map file retains its two existing lint warnings. Typecheck remains at the existing 89-error baseline.
- Full Nitro/Vercel build and output verification passed. Exact final-head CI and preview status are recorded on the PR.
- The disposable local API persisted all 49 definitions and copied a 50-Thing page/composition. Its copied source Action executed successfully against the unchanged authorized root.
- Chrome desktop and 375px checks covered linked visit creation, a 35-minute log and its total, quick status updates, nested replies, full-page scrolling and copied create/save/navigation. A overlapping comment/status write correctly rejected the stale status revision; retry after refresh succeeded.
- A synthetic PNG was uploaded and committed through a copied media Action. With the upload form open, the copied image Action saved the profile photo; API readback confirmed the image reference and preserved the customer name. The initial mixed-form-input failure was fixed before publication.
- Exact branch Gitleaks scan found no leaks. Generated graph snapshots and the final validation note are maintained separately from the implementation commit.

## Conversion boundary

Production page content, records and ACLs are unchanged. Team installation/revocation, remaining richer collection/planner controls and dependent pickers, and the live HQ migration are still part of the active conversion task. This PR does not declare that task finished or retire the native compatibility block.

Local: http://localhost:17120/p/qa-editable-builder-page. Tailscale/Funnel is unavailable because the installed shim targets a missing application binary. Preview: https://pr-895.previews.dev.thingtime.com (availability and exact head tracked on the PR).
