# Store growing ACLs and collection settings relationally

[PR #1497](https://github.com/lopugit/thingtime/pull/1497) repairs the production reporting preparation failure `acl can have at most 64 entries`. A shared private workspace reference had two audience markers and 62 task Character grants. The next grant failed, and the original external task remains the recovery target.

Growing audience and token grants are protected child Things with separate generations and revisions. The root carries a finite logical baseline and a legacy-reader compatibility fence. The new server does selective subject lookups, preserves exclusion precedence and current-root validation, and exposes an owner-only paged mutation/read API. Full ACL responses, Timeline snapshots, copies and backups remain complete for clients talking to the new server. Old server deployments deliberately deny nonowner reads of migrated public/custom Things; older explicit ACL writers and pre-migration writes must be scoped or drained before production migration.

The same task moves selected app grants, app origins/callbacks, encrypted account endpoints/deployment links, subspace definitions and learned algorithm weights into protected relational records. It removes arbitrary total count limits or truncation from relational groups, social edges, subspace memberships, invitations, reactions, pins, owned subspaces and custom flair choices, plus authored schema and Component count limits. Existing validation, rate controls, transaction accounting, owner checks and selected-origin boundaries remain in force. See [the contract and rollout notes](../docs/relational-access.md).

## Source and branch

- Isolated branch `codex/relational-acl-no-limits` started at fetched `origin/main` `f2538e19257bcfdf35ba050e7b187c94ea2252c0`.
- Source commits: `ea2ae9728` and `cf2e49ee9`; merged fetched main `31d2f3579` through normal merge commit `cacdbdb42`. The only source-text conflicts were `TESTING.md` and `remix/CHANGELOG.md`; both task and device/LiDAR entries were retained.
- Graphify wrapper needed two cross-volume fixes for this task's external scratch: absolute AST cache symlink and snapshot-local packed-graph hydration. Its focused suite passed 27/27. The final immutable graph snapshot is published separately after this note is staged. Long changed Markdown files were not newly semantically indexed: the earlier full semantic run was stopped after roughly 20 minutes and structural extraction is the documented fallback.

## Verified before PR publication

- Source-level TypeScript passed. Changed-source lint had no errors; warnings were pre-existing. Capability coverage passed 183 assertions. Focused ACL, reporting, OAuth, storage, subspace, feed, namespace, PAT/media and Graphify wrapper suites passed at their recorded revisions.
- Isolated built HTTP/OAuth/MCP/browser acceptance completed retained checks for concurrent workspace preparation above 64 Characters, exact ACL paging and readback, revocation/exclusion, selected-resource grants, large account settings and learned weights. Targeted desktop/mobile subspace UI passed after correcting two harness-only expectations. The synthetic runtime used a disposable APFS MongoDB because ExFAT index DDL exceeded the cold-start bound; it did not use production data.
- The post-main client/server rebuild and scoped rendered acceptance are pending at initial PR publication. Synthetic acceptance does not prove the deployed origin or original connected reporting task is repaired.

## Release gates still open

1. Verify the exact PR head, required checks/reviews and reachable Vercel preview. The public capability endpoints currently report production authority at `thingtime.com` and development authority at `dev.thingtime.com` and `master.previews.thingtime.com`; verify the exact branch preview before any synthetic writes. Public identity alone does not prove physical database separation.
2. Verify the legacy-reader deny-all fence on an older runtime, and scope or drain older explicit ACL writers and pre-migration in-flight writes. Preserve existing deployments and running tasks; an alias move alone is not a direct-connection drain.
3. After normal protected PR merge and compatible production deployment, resume the **same** previously failed external task and Character, save one lifecycle Action, and independently read back the resulting record through the canonical Thingtime MCP. Do not create a replacement task or claim completion from a manifest response alone.
