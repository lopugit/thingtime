# PR #604 — Route admin PR previews through github-actions

## Outcome

The product deployment now owns only admin authorization, live same-repository
PR validation, the durable Develop/Production preview policy, and one bounded
GitHub App dispatch containing the full selected environment set. The protected
controller merged in PR #603 owns the build, immediate PR comment, Vercel
publication, immutable snapshot links, persistent aliases, and cleanup.

## Product boundary

- Enabling, disabling, synchronizing, reopening, or closing a configured PR
  dispatches the complete environment policy to `github-actions`.
- A failed dispatch restores the changed policy switch; an observability-only
  event write cannot roll back a dispatch GitHub already accepted.
- The product backend no longer receives or uses the Vercel deployment token.
- The admin capability is deliberately bumped to `api.admin-ci-previews`
  `2.0.0` because the mutation response and execution ownership changed.
- Legacy product-side deployment, comment, alias, and cleanup modules are
  removed rather than left as a second publisher.

## Validation

- CI control unit suite: 60/60 pass
- API capability suite: 6/6 pass
- Focused ESLint: pass (existing Remix v7 deprecation warning only)
- Production Remix/Vercel build and output verification: pass
- Git diff whitespace check: pass
- Graphify refreshed; hooks and merge driver verified

## Live proof gate

Merge only after PR #603's protected controller proves an exact-head Develop
preview for PR #595. After this PR deploys, verify the admin CI Control UI at
desktop and mobile sizes and exercise a Develop-only admin selection so the
new route, dispatch, immediate URL/ETA comment, snapshot URL, and persistent
alias are covered end to end without using Production data.
