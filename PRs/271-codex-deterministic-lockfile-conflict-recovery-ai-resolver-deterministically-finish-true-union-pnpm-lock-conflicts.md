# PR #271 — deterministic pnpm lockfile conflict recovery

Branch: `codex/deterministic-lockfile-conflict-recovery`

Base: `github-actions`

PR: <https://github.com/lopugit/thingtime/pull/271>

## Root cause

PR #201's `remix/package.json` needs a genuine dependency union: its head adds
the private-S3 attachment packages while current `develop` adds Vercel Sandbox
and Workflow. The resolver model correctly resolved the source conflicts and,
under the old prompt, deliberately left `remix/pnpm-lock.yaml` marker-bearing
because neither side's lockfile represented that union. The trusted verifier
then stopped on the one unmerged path. Its failure comment fell back to the
pre-model conflict list, so it misleadingly presented every already-resolved
file as still conflicted.

The failed run was not a turn-budget problem. Claude Opus completed normally
after 56 turns under the 500-turn ceiling; the only verifier residual was the
lockfile.

## Resolution flow

1. Claude resolves every semantic/source conflict. When an adjacent manifest
   pins `pnpm@10.12.1` and needs a true dependency union, the prompt explicitly
   calls leaving that one pnpm lockfile marker-bearing a successful handoff.
2. A trusted inline step re-derives the conflicted set from immutable Git
   objects and proceeds only when exactly one marker-bearing path remains, that
   path is `pnpm-lock.yaml`, its base merge stage is a regular file, and its
   adjacent marker-free manifest pins the expected pnpm version.
3. The step starts from merge stage 3 (the base branch's valid lockfile), runs
   `pnpm@10.12.1 install --lockfile-only --ignore-scripts --ignore-pnpmfile`,
   and repeats with `--frozen-lockfile`.
4. Before/after tracked-diff and untracked-status snapshots must be identical
   outside the lockfile. The step does not stage, commit, or push anything.
5. The existing object-store verifier independently re-derives the allowed
   conflict set, stages the resolved files, checks markers/scope/secrets, and
   continues through its existing commit and publication flow.

## Credential and execution boundary

- The step contains no `${{ secrets.* }}` or `${{ github.token }}` expression.
- Checkout uses `persist-credentials: false`; the step rejects any local Git
  credential/extraheader that nevertheless appears.
- Common AI, GitHub, and npm credential variables are cleared before work.
- Corepack/pnpm runs under `env -i` with only explicit non-secret paths and
  hook-proof Git settings.
- The executable must resolve outside the model-writable workspace and runner
  temp directory.
- Lifecycle scripts and `.pnpmfile.cjs` hooks are disabled.
- The pnpm store, Corepack cache, home, npm cache, and config roots live under
  runner temp rather than the repository.

## Failure reporting

The verifier persists its actual unmerged set. If a failure occurs before the
verifier can stage model-resolved files, a read-only collector scans the
working-tree versions of the derived conflict paths and records only files
whose conflict markers remain. The failure comment consumes only that residual
file; it never falls back to the original merge list. A later safety or
publication failure with no residual paths says exactly that.

## Validation

- Parsed the workflow YAML and syntax-checked all changed Bash blocks.
- ShellCheck passed for the new regeneration and residual-collector blocks.
- All `.github/scripts` JavaScript and shell syntax checks passed.
- The complete local control-plane advisory suite passed.
- A residual-reporting fixture proved one marker-bearing source file is the
  only reported path, while a marker-free safety failure reports none.
- Replayed PR #201 head `171e295ebb74cb8262d7e757dc302dc2f1203a64`
  against current `develop` `1ffee9991e9c57ef2776ff9303ffb1619600b035`.
  The trusted handoff saw only `remix/pnpm-lock.yaml`, both pnpm passes
  succeeded, and the regenerated manifest + lockfile contained all six
  dependency additions from both sides:
  `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`,
  `@vercel/oidc-aws-credentials-provider`, `file-type`, `@vercel/sandbox`, and
  `workflow`. The unchanged verifier then committed a clean two-parent merge.

## Rollout

After PR #271 is reviewed and merged into `github-actions`, manually retry PR
#201 once with its exact PR selector so the trusted control plane reruns against
the unchanged paused snapshot. No primary-branch merge or auto-merge is part of
this PR.
