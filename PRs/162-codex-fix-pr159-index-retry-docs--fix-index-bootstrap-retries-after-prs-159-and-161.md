# PR #162 — Fix index bootstrap retries after PRs #159 and #161

Branch: `codex/fix-pr159-index-retry-docs`

## Context

PR #159 cached failed `ensureIndexes()` work for 60 seconds to prevent the
then-existing all-request retry storm. PR #161 subsequently removed
`ensureIndexes()` from hot request paths, leaving that cooldown able to reject
registration and admin migrations after MongoDB had already recovered.

## Resolution

- Keep in-flight and successful index work memoized per process.
- Clear failed index work so the next explicit bootstrap caller retries
  immediately.
- Keep ordinary API traffic isolated from the index battery.
- Describe limiter outages and index bootstrap failures as independent paths.
- Replace the stale cooldown checklist with the current boot/bootstrap
  behavior.

## Validation

- `npm --prefix remix run build` passed, including Vercel output verification.
- Two sequential `ensureIndexes()` calls against an intentionally unreachable
  local Mongo URI each made a fresh connection attempt (5075 ms and 5001 ms).
- `graphify explain ensureIndexes` resolves callers to boot warmup,
  registration, and migrations.
- `git diff --check` passed.
- Targeted ESLint remains blocked before file linting by the existing
  `@remix-run/eslint-config` / `eslint-scope` package-export incompatibility.
