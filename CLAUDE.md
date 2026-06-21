## Fundamentals (read first)

Read `FUNDAMENTALS.md` before adding features. Non-negotiables:
- All data access goes through the Thingtime API (`remix/app/routes/api/v1/...`) + the API utils layer. UI/scripts/tests never touch MongoDB directly.
- **Seed and test by calling the real API** (e.g. seed users via `POST /api/v1/auth/register`), never by writing to Mongo directly — so seeded data and real signups share one code path.
- One `thingtime` db (`users`, `sessions`, `things`); one connection source (`mongodb/config.ts` `getMongoUri()`).
- Auth: httpOnly cookie carrying a signed JWT (`jti`/`sub`/`exp`) + a Mongo `sessions` doc for revocation; Bearer token supported for API clients.

The active build roadmap lives in `claude-todo/`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
