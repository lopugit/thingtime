# Static analysis baselines and coverage

Audit date: 26 October 2026. Starting source: `ad0868db5698b5cbe3803a8595879f784ad1a0c2`.
This describes checks and their limits; final delivery results belong in the
PR and its validation note. Initial counts below are observations before repairs,
not allowed error budgets or claims about the final head.

## Policy and commands

The only explicit numeric error baseline found in the audited workspaces was
`remix/scripts/typecheck-baseline.json`. Its maintained target is **zero**.
`typecheck:ratchet` fails when the diagnostic count exceeds that value, and
`--update-baseline` refuses increases. Never edit the baseline upward or hide
errors with exclusions, suppressions or weaker compiler/lint settings.

```sh
corepack pnpm --dir remix run typecheck
corepack pnpm --dir remix run typecheck:ratchet
corepack pnpm --dir remix run lint
npm --prefix remix run test:typecheck-ratchet
```

Use `lint:files -- <files>` for fast feedback while editing, then full lint for
workspace acceptance. ESLint errors fail; warnings currently have no numeric
budget (`--max-warnings` is not configured). This change does not introduce a
zero-warning requirement. A missing compiler, invalid baseline, terminated
process or truncated output is a failure, never a zero-diagnostic success.
Baseline updates must not write after such failures. Duplicate object properties
and identifiers remain fatal even when exercising a nonzero historical fixture.

## Initial evidence

- Remix raw TypeScript: 92 diagnostics against the recorded baseline of 89.
  Most diagnostics originated in the legacy `app/smarts/index.tsx` helpers.
- Full Remix ESLint: 3,021 files, eight errors and 390 warnings. Seven errors
  were import ordering; one was a parser depth failure on generated font data.
  Fix the generator's output representation and regenerate it rather than
  excluding generated source or disabling parsing.
- The audited `origin/github-actions` Web CI lines 309–318 invoke
  `typecheck:ratchet`; its step label still calls it warning-only. The command's
  exit status now enforces the gate regardless of that stale label. That
  controller had no ESLint or Prettier CI step. The product workflow on `main`
  delegates to `github-actions`; changing product files does not change the
  protected controller's workflow implementation.

Re-run checks on the final head. These initial measurements do not prove final
zero errors, preview acceptance or CI results.

## Final local verification

The hardened ratchet ran the real Remix compiler successfully with zero
diagnostics and lowered the tracked baseline from 89 to 0; exact JSON readback
confirmed `errorCount: 0`. Full ESLint checked 3,023 files with zero errors and
390 warnings; focused lint also passed after the final helper/server edits.
These are local results, separate from the PR's eventual CI and preview state.

The final Nitro/Vercel server rebuild, canonical Claude-runtime packaging,
output patching, output verification and OS-denied compiled manifest/health
smoke passed. Client build, MCP typecheck, Commander's five package typechecks
and the focused regression suites also passed. See
[the validation note](../PRs/codex-typescript-zero-baseline.md) for scope and
review boundaries. Existing compiler settings and warning allowances remain.

## Workspace coverage

| Workspace | Audited checks and limits |
| --- | --- |
| Remix | Raw `tsc --noEmit`, strict count ratchet, full and focused ESLint. `format` runs `prettier --write`, so it mutates files and is not a check gate. |
| Commander | Recursive typecheck covers all five packages and passed in the audit. Daemon and desktop UI lint use TypeScript; Raycast lint uses `ray lint`. `format` runs strict `prettier --check .`. These are distinct coverage surfaces. |
| MCP | `npm ci` and `npm run typecheck` completed with zero diagnostics in the audit. This establishes that package's compiler result, not a repository-wide lint/format result. |
| Electron | No lint, typecheck or formatter package script was present. Runtime/build tests remain separate. |
| Root / lopu | Root ESLint still references `next/core-web-vitals` without a matching Next workspace; `lopu` has no TypeScript workspace. Do not present either as a passing compiler gate. |
| `deprecated/api` | Dormant ESLint configuration and dev dependencies; its package exposes only a dev command, with no automated lint, typecheck, format or test gate. No numerical tolerance was configured. |

Remix keeps `strict: false`, `noImplicitAny: false`, `strictNullChecks: false`
and `skipLibCheck: true`. A zero diagnostic count under these settings does not
prove strict null safety, explicit parameter typing or dependency declaration
checking. Preserve those settings in this repair; stronger checking needs its
own scoped work and acceptance criteria.

Root and Remix each contain `.prettierrc` and `.prettierrc.js`; the JSON
configuration uses `useTabs: true`, while the CommonJS configuration uses
`useTabs: false`. They are competing formatting definitions, not a numeric
baseline. Resolve a deliberate canonical format before introducing broad
formatting enforcement; do not mass-format unrelated source in this repair.

## Regression coverage

`remix/scripts/typecheck-ratchet.test.mjs` exercises passing/reduced counts,
refused increases, duplicate declarations, malformed baselines and compiler
process failures. `app/smarts/index.test.ts` exercises legacy context binding,
path aliases, list helper options, nested writes and explicit replacer state.
`app/routes/api/v1/health/mongodb/_mongodb.test.ts` covers a complete unavailable
remote status and session-cookie isolation; capability tests pin `api.health-mongodb`
1.0.2 on both manifests. See [TESTING.md](../TESTING.md) for the checklist.

## Follow-up priorities

1. In a separately authorized controller change, rename the stale warning-only
   step and add full ESLint error enforcement to Web CI. Verify actual job exit
   status and the exact source head, rather than relying on a displayed label.
2. Choose one canonical formatter configuration and add a read-only formatter
   check with an agreed scope before any formatting migration.
3. Add explicit analysis commands for uncovered workspaces where useful, and
   distinguish compiler-only lint from ESLint and runtime acceptance.
4. Address ESLint warnings by category and incrementally strengthen compiler
   checks in scoped changes. Keep the zero-error baseline intact throughout.

The tracked configuration inventory contained no SwiftLint, Ktlint, Detekt, Ruff
or Black configuration. Native compiler/build checks are separate; this audit
does not label unconfigured linters as passing.
