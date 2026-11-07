# PR #603 — Admin preview publisher controller

## Outcome

The protected `github-actions` branch owns admin-selected PR preview building,
publishing, aliasing, cleanup, and PR status comments. Product branches only
validate and dispatch the requested environment list.

Each admin run immediately posts or updates one marker-scoped PR comment with
every selected environment's persistent URL and estimated deployment time.
After publishing, the same comment adds each immutable snapshot URL and final
state.

## Security boundary

- Accepts only authenticated dispatches from the exact Thingtime GitHub App bot.
- Revalidates the live same-repository PR, head ref, head SHA, action, and full
  selected-environment set before doing work.
- Builds each selected environment in a secretless matrix at the authorized
  immutable PR SHA.
- Downloads and validates prebuilt artifacts in the protected publisher job;
  only that job receives the corresponding GitHub environment and Vercel
  credentials.
- Verifies the actual Vercel target or Custom Environment before aliasing or
  cleanup and mutates only marker-scoped resources for the exact repository/PR.

## Compatibility fix

The ordinary Develop preview controller accepts same-repository PRs based on
any live branch, rather than failing when a feature stack has no live parent
PR. PR #595 proved this at exact head
`ab3706c30d37da132cfc152f0aeb9576a0646407` through successful controller run
33741566074 (attempt 2), GitHub deployment 6243682642, and Vercel deployment
`dpl_89f42LfSMYDpiP9sGDuJP3cbGnN2`.

## Validation

- Admin preview publisher self-test: pass
- Develop preview publisher self-test: 105/105 pass
- Workflow control-plane contract: pass
- JavaScript syntax and workflow YAML parse: pass
- PR CI: 22 successful checks, 0 failing or pending before merge
- Live PR #595 exact-head build, publish, alias, and deployment receipt: pass
- Graphify refreshed; hooks and merge driver verified
