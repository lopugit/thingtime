# Build all Thingtime Vercel deployments on GitHub Actions

Date: 2026-10-23. Scope: `lopugit/thingtime` and the existing Vercel `thingtime`
project only. The owner excluded other Vercel projects and requested active
current-app staging.

## Resulting deployment contract

- Standard GitHub-hosted Ubuntu jobs compile an immutable product SHA without
  deployment credentials. A separate protected publisher validates the artifact
  and uploads it with pinned Vercel CLI `--prebuilt --archive=tgz`.
- `main` selects Production, `develop` selects its existing custom environment,
  and other product branches select Preview. The protected `github-actions`
  branch is never deployed as application source. Stale and fork source events
  cannot authorize publication.
- Vercel's native Git link and all three source deploy hooks are removed. Project
  install/build overrides reject source compilation; the ignore command skips
  it. Repository Git deployment flags are false for every branch.
- Production cron schedules are copied into Build Output API metadata, Preview
  schedules are removed, and Sydney placement is applied explicitly. Accepted
  deployment metadata is checked before publishing final receipts.
- READY outputs reconcile missing aliases/status without recompiling or
  uploading. Already-correct aliases/status are left alone. The output-policy
  marker prevents reuse of earlier incomplete artifacts.

## Staging activation

The old staging branch dated from June and lacked the current build system.
PR #1210 preserved its history and promoted the exact reviewed main tree to
staging. It now follows the persistent Preview workflow at
https://staging.thingtime.com. The account permits one custom environment,
already used by develop, so no additional paid environment was created.
Preview runtime settings remain separate from Production settings.

## Delivery and recovery

- [#1205](https://github.com/lopugit/thingtime/pull/1205): protected prebuilt
  build/publish controller.
- [#1206](https://github.com/lopugit/thingtime/pull/1206): main listener and
  repository source-build safeguards.
- [#1207](https://github.com/lopugit/thingtime/pull/1207): develop backport;
  replaced a pre-existing timing-dependent refresh assertion with an actual
  completion signal.
- [#1208](https://github.com/lopugit/thingtime/pull/1208): pair Vercel org/project
  CLI identifiers instead of relying on inherited context.
- [#1209](https://github.com/lopugit/thingtime/pull/1209): recover publication
  receipts after a READY upload; use the existing protected automation
  credential fallback. A prior GitHub HTTP 403 did not mean deployment failed.
- [#1210](https://github.com/lopugit/thingtime/pull/1210): activate current staging.
- [#1211](https://github.com/lopugit/thingtime/pull/1211): live audit found that
  root `vercel.json` alone did not populate prebuilt cron/region metadata.
  Apply and verify Build Output API policy explicitly. Production recovery
  reused the original GitHub-built artifact; it did not compile on Vercel.

The original working checkout and its unrelated conflicts were preserved. All
owned changes were made in isolated worktrees. Secrets were passed directly
through supported CLI/process interfaces and were not saved in these notes.

## Verification boundaries

Focused publisher, root-flow and extraction contracts cover source/target
identity, protected-job isolation, safe artifacts, stale/fork rejection, READY
recovery and output policy. Live acceptance reads Vercel's deployment and alias
records, then checks `/`, `/index.html`, a real JavaScript asset,
`/api/root-data`, and the origin-scoped capability manifest on immutable and
stable domains. Production cron definitions and regions are separate checks.
This infrastructure change does not claim new authenticated product-flow QA.

Structural graph outputs were refreshed. The existing large historical
Markdown corpus was not fully semantically reindexed; no semantic-freshness
claim is made. Private Thingtime task reporting could not be verified through
the available assigned browser navigation; the task-created tab was closed.
