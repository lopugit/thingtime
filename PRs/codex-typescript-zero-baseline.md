# Enforce zero TypeScript errors and repair static analysis failures

Source branch: `codex/typescript-zero-baseline`.
Starting commit: `ad0868db5698b5cbe3803a8595879f784ad1a0c2` (`origin/main` at task creation).
PR target: `develop`, as required by the product contribution lane.

## Change and review boundary

The initial Remix compiler reported 92 diagnostics against a recorded allowance
of 89. Full ESLint reported eight errors across 3,021 files, plus 390 warnings.
The owned change fixes source diagnostics and lint errors, hardens the ratchet
against compiler-process failures and baseline increases, and sets the maintained
TypeScript allowance to zero after a successful compiler run.

The branch starts from freshly fetched `main`, while the required PR target is
`develop`. Before this task's commit, that comparison already contained 108
non-Graphify file differences inherited from main history. Review this task's
focused commit separately from that inherited history; the task does not claim
ownership of those earlier changes. Do not silently change the requested base
or treat this PR as an authorized primary-branch promotion.

## Behavior and regression coverage

- Legacy smarts helpers now accept their implemented options and optional
  flags, preserve normal exported-object calls and support bound reactive
  contexts. Path aliases call canonical helpers; standalone `replacer` requires
  explicit serialization state instead of reading an uninitialized variable.
- Failed remote MongoDB health probes retain a complete disconnected response,
  including `custom: false` and unknown `replicaSet: null`, without forwarding
  local session cookies. Both capability manifests publish
  `api.health-mongodb` 1.0.2.
- The social-card font generator emits parser-safe chunks; unrelated lint
  fixes preserve hook behavior and imports. Byte request fixtures use owned
  `Uint8Array` buffers compatible with the current DOM types.
- Gate regressions cover invalid/missing baselines, diagnostic increases,
  duplicate declarations and failed/interrupted compiler runs. No source was
  excluded, suppressed or hidden behind weaker compiler/lint settings.

## Verification

The hardened real compiler run completed with zero diagnostics, lowered the
tracked baseline from 89 to 0, and exact JSON readback confirmed `errorCount: 0`. Full lint completed on 3,023 files with **zero errors and 390 warnings**;
subsequent changed helper/server files passed focused lint.

Focused suites passed: 13 gate checks, 39 smarts/Providers checks, 28
storage/migration checks, 30 reminder/social checks, 114 capability checks and ten
client checks. MCP typecheck and Commander's five package typechecks passed.
Client build, Nitro/Vercel server build, output verification and compiled
manifest/health smoke checks passed during validation. The compiled health
smoke used an OS-denied network boundary and verified the complete unavailable
shape plus capability version. The final server rebuild covers the last sandbox normalization edit; canonical
Claude-runtime packaging, output patching, output verification and compiled
health smoke all passed on that output. Expected unavailable-storage diagnostics
were observed under the OS-denied smoke boundary.

See [the audit](../docs/static-analysis-baselines.md) for coverage gaps:
390 warnings remain; Remix compiler strictness remains unchanged; formatter
configurations conflict; the protected `github-actions` controller still has a
stale warning-only label and no ESLint/Prettier CI step. This PR changes the
product listener comment, not that protected implementation. No native source
or installed app was changed. No primary-branch merge is authorized.
