## Codex workspace notes

- Also read `CODEX.md` for persistent environment/runbook notes before running checks or pushing branches from this workspace.
- On local desktop sessions, use the PM2 ecosystem configs for local dev servers instead of starting duplicate ad-hoc Remix servers. The local alias `pm` may be available for PM2; otherwise use `pm2`. The root `ecosystem.config.js` defines `thingtime-stack`, while `remix/ecosystem.config.js` defines the actual Remix dev app `tt-remix-9999` on port 9999. Prefer `npm run remix-pms` from the repo root or `cd remix && pm restart ecosystem.config.js --only tt-remix-9999` when restarting Remix locally. Stop/restart the managed app before claiming a local dev-server state.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
