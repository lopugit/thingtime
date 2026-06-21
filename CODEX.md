# Codex workspace notes

This file records workspace-specific setup fixes discovered while working in the Codex cloud/container environment. `AGENTS.md` is the standard Codex instruction file that agents automatically read; this file is a persistent operational runbook referenced from `AGENTS.md` so future agents can apply the same environment fixes quickly.

## GitHub push / PR publishing

- The repository may not have a configured Git remote in the cloud checkout.
- The canonical repository URL from `package.json` is `https://github.com/lopugit/thingtime.git`.
- If no remote exists, add it with:

  ```sh
  git remote add origin https://github.com/lopugit/thingtime.git
  ```

- Pushing from this environment still requires GitHub credentials or a pre-authenticated remote. If `git push -u origin <branch>` fails with `could not read Username for 'https://github.com': No such device or address`, the cloud container is not authenticated. In that case, commit locally, create the PR metadata with the available PR tool, and tell the user the branch could not be pushed because credentials are unavailable.
- The Codex Desktop GitHub plugin is not automatically available inside this terminal unless Codex exposes a matching MCP/tool. Check available MCP resources/tools first; if no GitHub tool is available, use Git credentials or an environment token.
- GitHub CLI can be installed in Ubuntu-based Codex containers with `sudo apt-get update && sudo apt-get install -y gh`.
- If a secret such as `GH_TOKEN` was added after the container/session started, it may not appear in the current shell; check with `env | sort | rg '^(GH|GITHUB)_'` and restart the Codex environment if needed.
- Recommended token setup: create a fine-grained GitHub token for `lopugit/thingtime` with Contents read/write and Pull requests read/write, add it to the Codex environment as `GH_TOKEN` or `GITHUB_TOKEN`, and push with `gh` or a credentialed remote such as `https://x-access-token:${GH_TOKEN}@github.com/lopugit/thingtime.git`. Do not paste tokens directly into chat.

## Graphify

- `AGENTS.md` asks agents to run `graphify query` and `graphify update .` when `graphify-out/graph.json` exists.
- If the `graphify` binary is not on `PATH`, install it from the upstream repository with:

  ```sh
  pipx install git+https://github.com/safishamsi/graphify.git
  ```

- After installing, verify with `graphify --help`, then run the required `graphify update .` from the repository root after code changes.

## Remix linting

- The repository root `.eslintrc.json` extends `next/core-web-vitals`, but the current checkout does not include a `next/` workspace or root-level `eslint-config-next` dependency.
- Running `pnpm --dir remix exec eslint ...` from the Remix app previously walked up to the root config and failed before linting Remix files.
- `remix/.eslintrc.json` is intentionally marked with `"root": true` so Remix lint commands stop at the Remix app config and do not inherit the root Next.js config.
- Preferred targeted lint command for Remix changes:

  ```sh
  pnpm --dir remix exec eslint <changed remix files>
  ```

## TypeScript checks

- Full `pnpm --dir remix exec tsc --noEmit` currently fails on pre-existing project/type issues outside the MongoDB files, including Commander components, `app/smarts/index.tsx`, and dependency declaration mismatches.
- Until those pre-existing issues are fixed, use targeted linting plus focused runtime/build checks where possible, and clearly report that full-project typecheck is blocked by existing errors.

## Package manager notes

- Use the package manager already used by the workspace being changed. For Remix app checks, prefer `pnpm --dir remix ...`.
- Avoid changing lockfiles unless dependency changes are intentional.
