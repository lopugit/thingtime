# Develop gateway integration — PR #1224

## Scope and ownership

Branch `codex/gateway-develop-integration` started clean at freshly fetched
`origin/develop` `f41cf65629fe98423405de4bea4e5894f59ccb46` in
`/Users/lopu/.codex/worktrees/gateway-develop-integration/thingtime`.
It ports only PR #1221's mainline delta plus dedicated policy source
`992447b9c`. It preserves newer develop changes rather than merging main.
The source comparison matches the reviewed dedicated implementation.

The source delta applied without code conflicts. The changelog keeps develop
entries and excludes an unrelated incoming drawer entry. Generated graph
conflicts were resolved by retaining the complete develop snapshot before
refreshing from the final combined source. The feature map now describes the
gateway, dedicated policy and readiness boundaries together.

## Verification — 2026-10-26

Gateway tests: 14; collection tests: 81 plus 5 module-mock lifecycle checks;
capability tests: 113; Lopu lifecycle tests: 42. All passed. Changed TS/TSX lint
and the Nitro node-server build passed. The repository ESLint parser rejects
`.mts` syntax; the canonical Node test commands validate those test files.

Built transport acceptance passed under the OS-enforced local network boundary:
registration, cookie authentication, writes/reads, Vite root docs, cross-site
refusal, dedicated own-handler/shell metadata and independent disposable DB,
promotion and rollback. Followers made zero MongoDB dials. Unchanged cold starts
issued zero index commands. The portable measured result is
[evidence/gateway-develop-integration.json](evidence/gateway-develop-integration.json).

## Rollout boundaries

No external configuration changes or merge are performed here. Canonical owner
bootstrap, reviewed controller integration, and drainage of old publisher jobs
remain prerequisites before merging the default-proxy runtime. Local fixtures
do not establish live alias acceptance. See
[the gateway runbook](../docs/environment-api-gateway.md) and
[PR #1224](https://github.com/lopugit/thingtime/pull/1224).

## Graph coverage

The final portable snapshot uses the repository wrapper's structural update,
clustering and high-limit HTML export. The proxy health check passed, but the
bounded semantic attempt selected a non-incremental full-corpus scan. It was
stopped before semantic dispatch instead of launching a whole-corpus LLM run.
Markdown and other non-code content are not newly semantically indexed; prior
semantic data is retained where available. The snapshot manifest records file
coverage, not proof of refreshed semantic extraction for these documents.

## Follow-up regression

The alias-ownership test fixture now pins proxy mode, while a separate assertion
checks the bundled connection policy and an explicit proxy override. This covers
both build policies without changing runtime behavior. The default-policy gateway
suite passed 14/14 after this fixture change. Local tests do not establish live
alias acceptance; that remains pending rollout.
