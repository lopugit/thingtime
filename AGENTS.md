## Codex workspace notes

- Also read `CODEX.md` for persistent environment/runbook notes before running checks or pushing branches from this workspace.
- On local desktop sessions, use the PM2 ecosystem configs for local dev servers instead of starting duplicate ad-hoc Remix servers. The local alias `pm` may be available for PM2; otherwise use `pm2`. The root `ecosystem.config.js` defines `thingtime-stack`, while `remix/ecosystem.config.js` defines the actual Remix dev app `tt-remix-9999` on port 9999. Prefer `npm run remix-pms` from the repo root or `cd remix && pm restart ecosystem.config.js --only tt-remix-9999` when restarting Remix locally. Stop/restart the managed app before claiming a local dev-server state.
- When a task reveals a repeatable workflow, validation command, deployment
  setting, project convention, or other future-use instruction, add it to this
  `AGENTS.md` runbook before finishing so future agents do it by default.
- When adding or changing a feature that depends on private/non-public
  configuration, external dashboards, secrets, deploy settings, or environment
  variables, also document the fork-safe setup steps in `README.md`. Use
  placeholder values only; never copy real tokens, passwords, project secrets,
  or account-specific credentials into public docs.
- For Vercel dashboard links, do not use `VERCEL_GIT_REPO_OWNER` as the
  dashboard owner slug; that value is the Git provider owner. Prefer Vercel API
  project/deployment data when `VERCEL_API_TOKEN` is available, or an explicit
  `VERCEL_DASHBOARD_TEAM_SLUG` env var for tokenless dashboard links.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Delivery messaging

- When finishing a branch update in this workspace, always report the pushed remote branch and the PR URL.
- If a PR exists (or was created), include the PR URL in your completion response.
- If Vercel preview deployment exists for that branch, include the most recent preview URL as well.
- When making or validating deployment, Vercel, hydration, environment, or local
  runbook workflow changes, add a concise dated entry to `remix/CHANGELOG.md`
  under `[Unreleased]` before finishing.
- For large PRs or PRs with several rounds of debugging, add or update a
  PR-specific note in `remix/PRs/` named with the PR number, branch slug, and
  PR title slug, then keep `remix/CHANGELOG.md` as a concise grouped summary
  that links to the detailed PR note.
