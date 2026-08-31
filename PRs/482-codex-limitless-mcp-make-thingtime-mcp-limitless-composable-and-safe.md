# PR #482 — Make Thingtime MCP limitless, composable, and safe

## Goal

Expand the original bounded Thingtime ChatGPT/Codex connector into a broad,
composable MCP surface without adding an arbitrary API proxy, raw database
querying, executable code, or silent mutations.

## Delivered surface

- 31 OAuth-protected tools, including ordered exact batch reads, schema
  discovery and validation, relationship/thread traversal, ACL-aware change
  polling, mutation preview/apply, encrypted history/undo, Capability discovery,
  and durable workflow runs.
- Five reusable MCP prompts, static and account-scoped resources, resource
  templates, and a responsive `ui://thingtime/review.html` MCP App with Result,
  Diff, and Raw modes.
- `Thingtime Capability` v1 data Things: a bounded declarative grammar that
  compiles only create/update/delete operations and exact `$input` placeholders.
- A capability manifest that independently versions the MCP, OAuth,
  connections, reads/writes, schemas, relationships, mutation previews,
  resources, history, workflows, UI, polling, and Capability contracts, and
  maps every executable MCP tool/method to one feature.

## Mutation safety model

1. Normalize at most 25 operations and reject duplicate targets or oversized
   payloads.
2. Check the selected account's exact PAT scopes and read every current target.
3. Produce a signed 30-minute before/after receipt with `updatedAt`
   preconditions and a reverse-order undo plan.
4. Require a second call carrying both the unmodified receipt and
   `confirmed: true`.
5. Preflight every target again before the first mutation, then execute
   serially and stop after the first failure.
6. Persist encrypted per-operation outcomes and only offer undo as another
   freshly previewed and confirmed plan.

The generic Thing update/delete endpoints now accept an optional
`expectedUpdatedAt` precondition. Update uses an exact MongoDB compare-and-set;
delete validates the exact root before cascade cleanup and keeps the root
identity anchored throughout the bounded drain.

## Compatibility and operational notes

- The original single-operation create/update/delete/comment/react/save/share
  tools remain for existing scanned ChatGPT apps; their semantic write feature
  advances to 1.1.0.
- MCP 1.3.0 advertises prompts and resources, while `resources/subscribe`
  remains honestly disabled. `list_thingtime_changes` is bounded polling, not
  a deletion CDC stream; MCP-applied deletions remain visible in encrypted
  history.
- Local stacks without Mongo/JWT configuration intentionally proxy API calls to
  production. Compiled-handler validation used the production-origin request
  path so it exercised this branch's 1.3.0 handler rather than the current
  production 1.2.0 fallback.

## Validation evidence

- Complete `test:unit` chain passed after final hardening.
- Production `build` and `verify:vercel-output` passed.
- The compiled Vercel handler returned MCP 1.3.0, 31 tools, five prompts, the
  two static resources, the embedded UI, and 36 manifest operations; the apply
  schema requires `receipt` and `confirmed` with `confirmed.const = true`.
- Focused ESLint and `git diff --check` passed.
- Browser QA covered 1100x760 and 390x844 viewports, full scrolling, all tabs,
  selection, expanded details, diff panes, confirmation gating, and horizontal
  overflow.
- Graphify semantic refresh completed after synchronizing the latest `main`
  through the local Codex proxy with 28,968 nodes, 71,787 edges, and 1,273
  communities.

## Live preview evidence

- The branch preview at
  `https://thingtime-git-codex-limitless-mcp-lopugits-projects.vercel.app`
  reached `READY` for commit `e0ec49ba1a3bf12daec6001f8a828c8a76bc45a4`.
- `/`, `/index.html`, and the built Vite asset returned 200 from the public
  branch alias.
- The live MCP endpoint returned version 1.3.0, 31 tools, five prompts, two
  resources, four resource templates, and the embedded review UI. The live
  capability manifest returned 14 features and 36 operations, and no API
  fallback header was present.
- GitHub's build, typecheck-ratchet, unit, headless API, product-contract,
  Vercel, and secret-scanning gates passed on that implementation commit.

A real reviewer-account OAuth/read/write smoke remains manual because no
account token is embedded in the repository or test environment.
