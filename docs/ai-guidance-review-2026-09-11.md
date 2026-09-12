# Thingtime AI guidance review — 11 September 2026

This review turns recurring PR feedback and follow-up fixes into instructions in
[AI_ALL.md](../AI_ALL.md#recurring-development-lessons--2026-09-11). It is an
engineering history review, not a new security audit or a claim that all features
have passed production or physical-device acceptance.

## Scope and method

- Window: **11 July 2026 00:00 AEST to 11 September 2026 19:33:25 AEST**
  (`2026-07-10T14:00:00Z` through `2026-09-11T09:33:25Z`).
- GitHub inventory: **750 PRs with activity in the window**: 632 merged, 89
  closed without a GitHub merge, 29 open at retrieval. **707 were opened in the
  window** (591 merged, 88 closed, 28 open); 43 older PRs remained relevant through
  later activity. The [complete metadata inventory](ai-guidance-pr-inventory-2026-09-11.json)
  records the selection, dates, bases, titles, states and public source links.
- Retrieved all matching PR titles/bodies and paginated repository discussion
  and inline review comments. In-window comments attached to the selected PRs:
  8,270 discussion comments across 622 PRs, plus 46 inline review comments across
  28 PRs. Routine status updates dominate this corpus. GitHub classifies 7,417
  discussion comments as Bot-authored and 853 as User-authored; owner-token
  automation also appears as User. These are **not counts of human requests**.
- Screened the full title inventory, then read representative bodies and
  substantive discussions across the recurring families below. Compared them
  with current source, regression tests, `FUNDAMENTALS.md`, `DECISIONS.md`,
  `TESTING.md`, the root instructions and the Graphify snapshot runbook. This is
  not a claim to have manually reviewed every line of every historical diff or
  every comment. The sources below are the evidence used for the new rules.
- A feature, its promotion and its follow-up do not automatically represent
  three independent incidents. Families group that lineage. Closed/superseded
  PRs preserve useful review evidence but do not prove delivery. PR descriptions
  and past approvals are historical evidence, never authorization for a new action.

The API retrieval can be repeated with authenticated `gh` (later states and
comments may have changed):

```sh
gh pr list --repo lopugit/thingtime --state all --limit 1000 \
  --search 'updated:>=2026-07-10T14:00:00Z created:<=2026-09-11T09:33:25Z' \
  --json number,title,state,createdAt,updatedAt,closedAt,mergedAt,baseRefName,url,body
gh api --paginate --slurp \
  'repos/lopugit/thingtime/issues/comments?since=2026-07-10T14%3A00%3A00Z&per_page=100&sort=created&direction=asc'
gh api --paginate --slurp \
  'repos/lopugit/thingtime/pulls/comments?since=2026-07-10T14%3A00%3A00Z&per_page=100&sort=created&direction=asc'
```

Filter comment creation timestamps to the window and PR numbers to the inventory.
GitHub GraphQL `search.issueCount` independently returned 750, below the 1,000
search limit. Raw comment bodies are deliberately not committed: they contain
noise and can include expiring signed media links. The committed metadata has
no raw review bodies, credential values or signed resource URLs.

## Current source checkpoint

| Surface | Verified checkpoint | Implication |
| --- | --- | --- |
| Default branch | `main`, `9ef38477c0397eeaaf0587d8e84315cfee3faed9` | Current product source, not the attached checkout's old branch. |
| Integration branch | `develop`, `c1fdea98b9620bef9711dd7910107b5debe14270` | Two ancestry commits ahead of main, with an identical tree at this checkpoint. Documentation branch starts here. |
| Protected controller | `github-actions`, `45f63271bd2312c1dc7824616f575abc1ea85dea` | Workflow implementation has a separate branch and lifecycle. Product guidance there can lag product source. |
| Root instruction discovery | `AGENTS.md` and `CLAUDE.md`, Git mode `120000`, relative target `AI_ALL.md`; no root `CODEX.md` | Keep one canonical repo file. The old attached checkout predates consolidation. |
| Web entry | `remix/app/entry.client.tsx` uses `createRoot`; route loading in `remix/app/routes.tsx`; Vite + Nitro | Do not prescribe an old SSR/hydration repair without inspecting the current entry. |
| Runtime/dependencies | `remix/package.json`: Node `24.x`; root and Remix pin `pnpm@10.12.1`; `worktree-setup` repairs dependencies | Install from the lockfile/shared store; do not copy pnpm symlink trees. |
| Contracts | `app/docs/apiDocs.ts`, `app/docs/apiCapabilities.test.ts`, `api/utils/capabilities/`, `server/routes/api/[...].ts` under `remix/` | Registries, executable routes, both manifest surfaces and client requirements must agree. |
| Type checking | `remix/scripts/typecheck-ratchet.mjs` explicitly returns success for increased diagnostic counts | A green ratchet is not a clean raw typecheck. Counts quoted in old PRs are not a current baseline measurement. |
| Graphify | `scripts/graphify` + immutable snapshots/CAS; root aliases ignored; both Graphify hooks installed | Preserve the current wrapper and snapshot model, not the older mutable-file instructions. |

No app server, live database migration, external account setting, native binary,
or primary branch was changed for this documentation review. Current deployed
behavior must still be checked separately when a future task touches it.

## Recurring findings and the rules they support

| Family | Evidence and repeated failure | Current source to inspect; instruction added |
| --- | --- | --- |
| One implementation and coordinated work | [#163](https://github.com/lopugit/thingtime/pull/163) unified instruction files and stopped copying dependency trees. [#118 discussion](https://github.com/lopugit/thingtime/pull/118#issuecomment-5030178950) documents several parallel duplicate TODO implementations. [#121](https://github.com/lopugit/thingtime/pull/121) consolidated three testing PRs. | `AI_ALL.md`, `.worktreeinclude`, `remix/scripts/ensure-dependencies.js`, `TODO/`. Check current source, PRs and ownership before starting; preserve distinct regressions when consolidating. |
| Payloads lost between UI and persistence | [#345](https://github.com/lopugit/thingtime/pull/345) repaired media layout transport; [#519](https://github.com/lopugit/thingtime/pull/519) flushed live Editor.js state; [#525](https://github.com/lopugit/thingtime/pull/525) then found that the client allowlist still omitted rich text. | `remix/app/hooks/thingsRequestPayload.ts`, `useApi.tsx`, `components/Feed/PostComposer.tsx`, `components/Editor/`. Prove immediate edit → real browser request → exact-ID readback → reload rendering. |
| Cache and async ownership | [#56](https://github.com/lopugit/thingtime/pull/56) established optimistic first paint; [#141 reaction-race discussion](https://github.com/lopugit/thingtime/pull/141#issuecomment-5077289974) found stale reads overwrote local reactions; [#641](https://github.com/lopugit/thingtime/pull/641), [#740](https://github.com/lopugit/thingtime/pull/740), [#741](https://github.com/lopugit/thingtime/pull/741) fix account, page and mode boundaries. | `remix/app/hooks/localCache.ts`, `components/Builder/useWebpage.ts`, `components/Feed/reactionOverlay.ts`, `components/Lopu/`. Preserve same-owner state; reset identity boundaries synchronously; fence late completions. |
| Data serialization and shared surfaces | [#92/#104 comparison](https://github.com/lopugit/thingtime/pull/92#issuecomment-5033400602) showed a persistence defect propagated into cross-tab sync; [#99](https://github.com/lopugit/thingtime/pull/99) removed persisted execution. | `remix/app/Providers/thingtimeSerialization.ts` and tests distinguish real Dates from date-like strings, keep legacy function tags inert, and preserve cycles. Test persistence and cross-tab transport together. |
| Compositional sharing and copies | [#707](https://github.com/lopugit/thingtime/pull/707), [#714](https://github.com/lopugit/thingtime/pull/714), [#719](https://github.com/lopugit/thingtime/pull/719), [#730](https://github.com/lopugit/thingtime/pull/730), [#733](https://github.com/lopugit/thingtime/pull/733), [#736](https://github.com/lopugit/thingtime/pull/736), [#747](https://github.com/lopugit/thingtime/pull/747), [#753](https://github.com/lopugit/thingtime/pull/753), [#755](https://github.com/lopugit/thingtime/pull/755) successively cover schemas, CSS/HTML, saved arguments, conditional outputs, actions, foreign audience boundaries and actual file copies. | `remix/app/api/utils/webpages/`, `actions/sharedComposition.ts`, `components/ComponentsLibrary/componentTemplate.ts`, `webpages/sharedComposition.integration.test.ts`. One bounded stored-dependency traversal for authorization, writing and copying; recheck all audience boundaries and exact source versions. |
| Uniqueness must survive every writer | [#90](https://github.com/lopugit/thingtime/pull/90), [#320](https://github.com/lopugit/thingtime/pull/320), [#325](https://github.com/lopugit/thingtime/pull/325), [#326](https://github.com/lopugit/thingtime/pull/326) move uniqueness away from user-writable crystal fields. [#401](https://github.com/lopugit/thingtime/pull/401) reintroduced the class through passkey links; [#696](https://github.com/lopugit/thingtime/pull/696) found the dedicated poll writer omitted its protected vote identity. | `remix/app/api/utils/messenger/shared.ts`, `things/vote.ts`, `mongodb/collections.ts`, `mongodb/indexAudit.ts`. Audit generic, dedicated and migration writers; exercise concurrent create/move/toggle and hostile crystal-name reuse. |
| Storage correctness and migration ordering | [#182](https://github.com/lopugit/thingtime/pull/182), [#187](https://github.com/lopugit/thingtime/pull/187), [#197](https://github.com/lopugit/thingtime/pull/197), [#360](https://github.com/lopugit/thingtime/pull/360), [#601](https://github.com/lopugit/thingtime/pull/601), [#674](https://github.com/lopugit/thingtime/pull/674), [#676](https://github.com/lopugit/thingtime/pull/676) expose client/session mismatches, missing protected projections and version/optional-field drift. | `remix/app/api/utils/storage/`, `migrations/`, `mongodb/collections.ts`. Preserve exact logical-byte accounting, real transactions, home/data-plane alignment, protected envelope projections, fail-closed readiness and resumable migration prerequisites. |
| Index and telemetry budgets | [#583](https://github.com/lopugit/thingtime/pull/583) separated high-volume CI telemetry; [#692](https://github.com/lopugit/thingtime/pull/692) introduced staged shared-plan auditing; [#696](https://github.com/lopugit/thingtime/pull/696) demonstrates why index removal requires writer coverage. | `remix/app/api/utils/ciControl/`, `mongodb/indexAudit.ts`, `mongodb/indexLayoutActivation.test.ts`, `docs/architecture/thing-index-consolidation.md`. Inventory queries/writers and old previews before retirement; preserve unique constraints and drain gates. |
| Privacy and origin-bound auth | [#70](https://github.com/lopugit/thingtime/pull/70), [#168](https://github.com/lopugit/thingtime/pull/168), [#197](https://github.com/lopugit/thingtime/pull/197), [#280](https://github.com/lopugit/thingtime/pull/280), [#678](https://github.com/lopugit/thingtime/pull/678), [#710](https://github.com/lopugit/thingtime/pull/710) repeatedly constrain public projections and secret reveals. [#356](https://github.com/lopugit/thingtime/pull/356), [#567](https://github.com/lopugit/thingtime/pull/567), [#594](https://github.com/lopugit/thingtime/pull/594), [#600](https://github.com/lopugit/thingtime/pull/600), [#641](https://github.com/lopugit/thingtime/pull/641) repair different OAuth/passkey completion paths. | `remix/app/root-data.server.ts`, `api/utils/auth/`, `api/utils/chatgpt/`, `routes/api/v1/vault/reveal/`. Keep private projection and fresh verification separate from UI visibility; test the actual host, callback, cancellation and revocation path. |
| Capability and deployment drift | [#501](https://github.com/lopugit/thingtime/pull/501) returned HTML with HTTP 200 for a manifest; [#503](https://github.com/lopugit/thingtime/pull/503) fixed stale chunks on moving aliases; [#629](https://github.com/lopugit/thingtime/pull/629) exposed exact runtime identity; [#748](https://github.com/lopugit/thingtime/pull/748) fixed retrying an HTTP-cached incompatible manifest. | `remix/app/api/utils/capabilities/requireCapability.client.ts`, `app/utils/staleChunkRecovery.ts`, `remix/scripts/verify-vercel-output.mjs`, `remix/app/docs/apiDocs.ts`. Prove emitted routes, JSON content type, origin, feature versions, retry behavior and exact deployed source. |
| Product UI parity and settings | [#141 feedback](https://github.com/lopugit/thingtime/pull/141#issuecomment-5077156349), [#532](https://github.com/lopugit/thingtime/pull/532), [#635](https://github.com/lopugit/thingtime/pull/635), [#691](https://github.com/lopugit/thingtime/pull/691), [#709](https://github.com/lopugit/thingtime/pull/709), [#742](https://github.com/lopugit/thingtime/pull/742), [#759](https://github.com/lopugit/thingtime/pull/759) cover mobile controls, stacked modals, shared settings and long tool labels. | `remix/app/components/Settings/SettingsContent.tsx`, `components/Editor/`, `components/Lopu/`, `TESTING.md`. Share behavior across modal/page and mouse/touch/keyboard; test opened controls, long content, reload/back, and actual editable focus. |
| Lopu proposals and history | [#745](https://github.com/lopugit/thingtime/pull/745) restores historical receipts to later replies; [#751](https://github.com/lopugit/thingtime/pull/751) opens the real approval card; [#758](https://github.com/lopugit/thingtime/pull/758) stops labelling a saved approval request as execution failure. [#672](https://github.com/lopugit/thingtime/pull/672) records Lopu's pronoun. | `remix/app/api/utils/lopu/`, `api/utils/messenger/`, `components/Lopu/lopuTurnCore.ts`. Historical evidence is not a fresh grant; distinguish requested/approved/succeeded/failed, and refer to Lopu as it. |
| Native delivery and notification truth | [#682](https://github.com/lopugit/thingtime/pull/682), [#700](https://github.com/lopugit/thingtime/pull/700) repair helper/permission recovery; [#715](https://github.com/lopugit/thingtime/pull/715), [#720](https://github.com/lopugit/thingtime/pull/720), [#729](https://github.com/lopugit/thingtime/pull/729) separate native recording capability, recovery, and APNs acceptance. [#705](https://github.com/lopugit/thingtime/pull/705), [#708](https://github.com/lopugit/thingtime/pull/708) retain notification history independent of delivery. | `iOS/`, `electron/`, `macos/`, `remix/app/api/utils/notifications/`. Test installed identity, protected operation, persistence, provider acceptance and the physical notification/recording separately; history alone cannot prove a banner. |
| Recording consent and recoverable work | [#754](https://github.com/lopugit/thingtime/pull/754), [#760](https://github.com/lopugit/thingtime/pull/760), [#761](https://github.com/lopugit/thingtime/pull/761) add personally paired processing, an opt-in HTTP fixture and explicit saved-recording handoff. | `remix/app/api/utils/lopu/`, `remix/scripts/personal-recording-*`, `TESTING.md`. Revalidate consent, account/source/device/processor before disclosure and commit; preserve recovery and idempotency; synthetic transport proof is not provider or Watch acceptance. |
| Controller event loops and truthful delivery | [#624](https://github.com/lopugit/thingtime/pull/624), [#625](https://github.com/lopugit/thingtime/pull/625), [#626](https://github.com/lopugit/thingtime/pull/626), [#634](https://github.com/lopugit/thingtime/pull/634) expose owner-token bot loops, wrong build lanes and global concurrency; [#671](https://github.com/lopugit/thingtime/pull/671), [#724](https://github.com/lopugit/thingtime/pull/724) distinguish source delivery from ancestry/generated churn. | Protected `.github/scripts/` and workflow contracts on `github-actions`; product `remix/app/api/utils/ciControl/`. Admission before expensive work, durable exact-head ownership, no-op status writes, terminal-state evidence and source-aware promotion comparisons. |
| Graph lifecycle and instruction drift | [#45](https://github.com/lopugit/thingtime/pull/45) introduced atomic mutable-pair handling; [#436](https://github.com/lopugit/thingtime/pull/436), [#437](https://github.com/lopugit/thingtime/pull/437), [#438](https://github.com/lopugit/thingtime/pull/438), [#464](https://github.com/lopugit/thingtime/pull/464), [#645](https://github.com/lopugit/thingtime/pull/645) replace it with immutable snapshots, repair aliases, align source fingerprints and guard readers/writers. | `scripts/graphify`, `scripts/graphify-cas.mjs`, `docs/graphify-content-addressed-snapshots.md`. Finish source edits first, stage new docs, use the wrapper, verify membership in both graph and manifest, and retain extraction limitations. |

## Preservation and maintenance

The pre-update repo file is retained in Git history at the product checkpoint.
Every existing topic remains in the updated working guidance. The obsolete
no-active-hooks assertion and fixed historical typecheck examples are replaced
with live inspection instructions; product and protected-controller PR lanes
are stated separately. No root compatibility symlink is rewritten.

The global file is included **verbatim**, inside a labelled reference block at
the end of the root document. Its commands describe the original machine; this
copy does not replace the canonical global file or make historical permission
text actionable. The working Thingtime instructions remain first so an agent
can find the current rules without reading a second global runbook.

| Original input | Bytes | SHA-256 |
| --- | ---: | --- |
| Repo `AI_ALL.md` at the checkpoint above | 24,743 | `3eac38aba26eeb1c9ed39c8d4d233a8d2afe27a8a609bdb1e7ffa8ad13fd5719` |
| `/Users/lopu/.AI/AI_ALL.md` snapshot | 38,768 | `72fa2b188df422ce376dfb18b8db5987f76d4714e090b24c1ef2c272f9f56881` |

For future updates, add a rule only when an actual recurring failure or explicit
owner decision supports it. Include a trigger, the canonical implementation or
runbook, the failure to prevent and meaningful verification. Extend an existing
rule instead of duplicating it. Keep dated measurements and release status in
the review/PR note; re-query live state before making a current claim. Preserve
all useful evidence and regressions when a duplicate PR is superseded.
