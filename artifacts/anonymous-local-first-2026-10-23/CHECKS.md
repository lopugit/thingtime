# Verification boundaries — 23 October 2026

This is local evidence for the continuation of `codex/anonymous-local-first`,
starting at `fd49b8d1e63d106ad20d67a77271aaa2a2e4bf4d`. It is not CI, a deployed
preview, the installed macOS application, or this chat's native MCP connection.
The [source audit](matrix-source-audit.md) lists remaining implementation gaps.
The [artifact README](README.md) provides actual downloads and MCP usage.

## Regression checks

| Check | Result | Evidence |
| --- | --- | --- |
| Complete local-workspace suite | 794 passed, 94 opt-in skipped; then 4 offline-shell tests passed | [Log](regression/workspace-copy-repair.log) |
| Timeline | 261 passed | [Log](regression/timeline-final.log) |
| Drafts | 50 passed, 9 opt-in browser tests skipped | [Log](regression/drafts-final.log) |
| Attachments | 356 passed plus 12 prechecks | [Log](thingtime-linked-attachments-full.log) |
| Media cache | 7 passed | [Log](regression/media-cache.log) |
| Graphify snapshot wrapper | 25 passed; query-cache reuse failure reproduced before the fix; portable integrity checks preserved | [Repair evidence](graphify-repair/README.md) |
| Changed Remix source/test lint | 0 errors, 9 warnings, including intentional unsafe-URL rejection fixtures | [Log](regression/lint-integrated.log) |
| Algorithm capability contracts | 129 passed | [Log](algorithm-history/capabilities.log) |
| Feed deletion race | Both new cases fail before the fix; focused suite 38 passed | [Review](feed-review/README.md) |

Focused suites overlap; do not add their counts. Browser opt-ins are counted as
skipped in the broad suites and have their own actual results below. The final full suite includes the canonical MIME repair, protected History, Home scope, feeds,
URL drafts/templates, complete file copies and both transaction admission fences.
The first integrated run had three bound-media test failures because its synthetic
GET response omitted canonical `targetId`. The real server projection includes
that field. Only the fixture was corrected; all 64 focused media checks and the
full rerun pass with the identity guard unchanged. The original failure log is
retained as [integrated first run](regression/workspace-integrated.log).

The fetched source contained three missing test-block closures in two attachment
test files. After only those parse repairs, an independently archived baseline
has 91 TypeScript diagnostics. The final frozen-product comparison has exactly the same 91
normalized signatures, with none added or removed; a clean typecheck is not
claimed. See the [comparison](regression/typecheck-copy-repair-comparison.json) and
[current output](regression/typecheck-copy-repair.log). The comparison includes the
final URL/draft/copy integration, transaction admission fence and canonical MIME
receipt repair.

## Native and API checks

The final repair package is
`15e93be01ba2478f19fbdd20201bb18d72ab6c87f794e5a7c4800854b4ab85a7`
(2,035 files; 231,149,415 bytes). The complete client/template/server build
passes with all 2,975 production/configuration inputs unchanged at source hash
`8a95b2df38f68bc247d1492c74eec5689bcc526c59888fc1cf4acdfb9db17476`.
Only `accountFileMetadata.ts` differs from the integrated package source.
The [MIME repair](file-mime-repair/README.md) preserves the original request MIME
while comparing later metadata against its verified canonical upload receipt.
See the [build comparison](linux-isolation/copy-repair-source-comparison.json).
The [final rehash](linux-isolation/copy-repair-source-final-comparison.json)
confirms no production/configuration drift after acceptance. All task runtimes
were stopped and private state removed; [cleanup summary](linux-isolation/final-cleanup-summary.json)
records the completed cleanup. The final evidence scan found no credential
values or private runtime files, including a direct in-memory comparison with
the generated disposable admin credentials.

The [Linux runtime evidence](linux-isolation/README.md) records immutable build
hashes, fresh namespaces and cleanup. The preceding integrated package used for linked-gallery, posting, instruction
and capacity results (and earlier renderer/web/Builder/importer runs) is
`2f0710ac20e67675e56271dd5607a7a32c2e038853e40ebd62dbf40c9e310e59`
(2,035 files; 231,147,871 bytes). All 2,975 production/configuration input hashes
were unchanged during the complete client/template/server build: [comparison](
linux-isolation/integrated-source-comparison.json). Independent integrated remote,
links and core namespaces pass the full browser/backend isolation proof. The
final repair namespace passes the same full proof; package-scoped results below
identify which checks were repeated after the one-file MIME repair.

Earlier native checks remain pinned to their recorded packages. Snapshot `c41befc0600c979d80f4912e1cdb01cb22218c834531d80088922e9d7f1d319e`
has 2,033 files and 242,614,199 bytes. Chromium's sandbox remains enabled.
Both browser and backend deny direct IPv4, mapped/native IPv6, hostname and
redirect egress. Host profiles, dotenv files, Git configuration and inherited
credentials are absent. Only required runtime/source/dependency mounts and
disposable fixture state are exposed. Cgroup memory readings cover the managed
workspace, not one namespace.

| Check | Result and scope | Evidence |
| --- | --- | --- |
| Real linked-attachment API | Passed on integrated package 2f0710ac: concurrent first creation/exact replay, one quota charge, owner/guest/foreign boundaries, binding/annotation, version/target deletion and cancellation/cascade replay fences; cleanup asserted | [Report](linked-request-api-verification.json), [log](linked-api-integrated.log) |
| Actual SDK-to-MCP stdio call | Passed on final package 15e93be0: native JSON/PNG, rejection and concurrency cases; no account/backend/outbound route | [MCP verification](verification.json), [log](mcp-copy-repair-acceptance.log) |
| Clean no-account web editor | Passed on final package 15e93be0: actual download hash, opaque-origin storage denial and zero API requests | [Report](web-verification.json), [download](web-thingtime-draft.json) |
| Normal importer | Passed on final package 15e93be0: fresh IDs, dependency remapping, exact content, private ACL, guest refusal, canonical re-export and asserted cleanup | [Report](import-verification.json) |
| Individual Builder editing | Passed on final package 15e93be0: nested text/button/icon/repeated-row edits, styles/reorder/duplicate/delete, cold offline reload and complete dependencies at 1440/390/320px | [Report](editable-blocks/verification.json) |
| Algorithm History | Two cases passed, anonymous and account; actual History receipts/export during content 503s, then independent content retry | [Final build evidence](algorithm-history/README.md) |
| Larger normal import | One case passed: 20 independent JSON transfers, exact Unicode, fresh IDs, cold reload, 1440/390/320px and zero account writes | [Integrated build evidence](capacity-integrated-native/README.md) |
| Account file Duplicate | One case passed on final package 15e93be0: strict offline barrier, exact copied bytes/fresh IDs/cold reload, independent upload during original 503, both canonical folder placements, normal Retry and guest refusal at all three widths | [Native evidence](account-file-copy/README.md), [MIME repair](file-mime-repair/README.md) |
| Independent posting/drafts | One integrated case passed both directions: private post before held draft 503; another working draft before held post 503, identical post retry with one canonical ID, cold reload and private guest refusal | [Evidence](posting/README.md), [report](posting/integrated-final/verification.json) |
| Linked galleries and URL drafts/templates | Four native scenarios passed on integrated package: anonymous/account mixed transfer, direct URL selection, offline reload, independent templates, exact annotations/bytes, immutable lost-response retry and private guest refusal | [Scenario manifest](linked-gallery/manifest.json) |
| Account instruction reconnect | One case passed on integrated package 2f0710ac: offline UI save/cold reload, real server commit with lost reply while a newer local edit saves, no duplicate replay, both reviewed conflict choices and guest refusal | [Native evidence](account-instructions/README.md) |
| Account mail-settings reconnect | One case passed: normal offline UI save/cold reload, identical durable retry after a lost successful response, preserved newer intent, both reviewed conflicts and guest refusal; no provider delivery | [Native evidence](account-mail-settings/README.md) |
| Theme History, organization and custom plane | Seven cases passed after Home-context and 320px panel fixes: anonymous/Home/custom-selected History, the three organization variants and normal import/export | [Scenario manifest](theme-history/repaired-edd245b3/manifest.json) |
| Audience/composer/device feed | One native case passed on e7427480, including active and collapsed 320px composer collisions, real block recovery, audience labels, private guest/foreign refusals and cold offline feed | [Final native proof](responsive-ui-feed/README.md) |
| Progress-plan UI | Passed at 1440/390/320: 87 cards, all status/priority filters, search/empty reset, section scrolling, footer and no document overflow; exact tested HTML hash recorded | [Report](plan/verification.json), [log](plan-static-acceptance.log) |

The posting fixture first used Playwright's separate API client, which omitted
Secure cookies on HTTP loopback. It now uses normal Chromium fetch. The
loopback-only OS namespace also needs explicit CDP online/offline signals in
addition to transport emulation; the test asserts both `navigator.onLine` and
failed real root fetch while offline. Neither correction adds an external route
or weakens cookie policy. Setup failures remain in `posting/`.

The first capacity run timed out while 11 of 20 imports had completed, without
errors or OOM. The successful rerun uses unchanged product bytes and a bounded
90-second completion wait. Shared-backend signup 429s were preserved; fresh
disposable namespaces separate subsequent suites without relaxing rate limits.

## Open delivery gates

There is no callable Thingtime tool in this chat's tool catalogue, and plugin
discovery found no Thingtime connector. [Discovery](agent-host-discovery.json)
does not establish an actual host transport. An SDK client or HTTP endpoint is
not a substitute for that acceptance.

Deleted theme/algorithm recovery, other protected/managed operations,
other managed imports, larger transfer/remote catalogue contracts, additional
Action adapters and wider native/service/account-transition coverage remain
open. Earlier `tmp/` links are historical and may not exist in cloud.

No merge, manual deployment, public test content or existing real-account
mutation was performed. CI and preview status must be checked against the
pushed branch separately; the initial reachable preview served an older build.

## Repository map and coordination

Graphify is refreshed through the repository wrapper after source and evidence
are staged. The configured local semantic proxy is unavailable in this cloud
workspace, so extraction uses the structural/code path; Markdown, images and
other non-code content are not semantically indexed. Snapshot metadata supplies
the source fingerprint. File presence in a manifest is not semantic coverage.
A routed query exposed an existing wrapper bug: its ignored local cache made
the snapshot appear invalid. The reviewed fix accepts only that real cache
directory, preserves portable hashes and unexpected-entry rejection, and keeps
generated snapshot HTML untracked. This tooling repair does not change the
verified application package.

The supported Character preflight returned `NETWORK_ERROR`; no authenticated
Character overview or coordination write was available. This did not block
implementation or justify borrowing credentials or relaxing isolation.
