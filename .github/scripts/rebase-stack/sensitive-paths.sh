#!/usr/bin/env bash

# The single sensitive-path deny-list, shared by prepare-round.sh (which
# refuses to show these files to the model) and promotion-worker.sh (which
# settles their promotion conflicts byte-exactly to the source patch BEFORE
# the model round, so the round never receives them). One file, one policy:
# the guarantee both callers rely on is that no model-authored content ever
# lands in a path matching this list. Callers set CONFLICT_POLICY before use
# (promotion widens the credential-name patterns beyond .github/).

sensitive_path() {
  local path="$1"
  local base="${path##*/}"
  local lower
  lower="$(tr '[:upper:]' '[:lower:]' <<<"$path")"
  # Credential-bearing names remain closed everywhere in promotion mode, not
  # only under .github/. Keep the legacy PR-rebase policy unchanged. Word-like
  # boundaries avoid false positives such as keyboard.ts while catching
  # secrets/, api-key.*, and private_token.*.
  if [[ "$CONFLICT_POLICY" == promotion \
        && "$lower" =~ (^|[/_.-])(secret|secrets|credential|credentials|token|tokens|password|passwords|passwd|key|keys|private)([/_.-]|$) ]]; then
    return 0
  fi
  case "$path" in
    .github/*|*/.github/*)
      if [[ "$CONFLICT_POLICY" != promotion ]]; then
        return 0
      fi
      # Promotion mode is reachable only from the fixed develop control plane
      # and replays code already merged there. It may resolve workflow/action
      # conflicts, but path names that plausibly carry credentials remain
      # outside the model even in that mode.
      ;;
  esac
  case "$path" in
    .gitattributes|*/.gitattributes|.gitmodules|*/.gitmodules|\
    .claude/*|*/.claude/*|.mcp.json|*/.mcp.json|.claude.json|*/.claude.json|\
    CLAUDE.md|*/CLAUDE.md|CLAUDE.local.md|*/CLAUDE.local.md|\
    AGENTS.md|*/AGENTS.md|AGENTS.override.md|*/AGENTS.override.md|AI_ALL.md|*/AI_ALL.md|\
    .ripgreprc|*/.ripgreprc|.husky/*|*/.husky/*|\
    .env|.env.*|*/.env|*/.env.*|\
    .npmrc|*/.npmrc|.yarnrc|.yarnrc.*|*/.yarnrc|*/.yarnrc.*|\
    package.json|*/package.json|package-lock.json|*/package-lock.json|\
    pnpm-lock.yaml|*/pnpm-lock.yaml|pnpm-workspace.yaml|*/pnpm-workspace.yaml|\
    yarn.lock|*/yarn.lock|bun.lock|*/bun.lock|bun.lockb|*/bun.lockb|\
    Dockerfile|*/Dockerfile|Dockerfile.*|*/Dockerfile.*|\
    docker-compose.yml|*/docker-compose.yml|docker-compose.yaml|*/docker-compose.yaml|\
    compose.yml|*/compose.yml|compose.yaml|*/compose.yaml|\
    Makefile|*/Makefile|GNUmakefile|*/GNUmakefile|justfile|*/justfile|\
    *.pem|*.key|*.p12|*.pfx|CODEOWNERS|*/CODEOWNERS)
      return 0
      ;;
  esac
  case "$base" in
    vite.config.*|nitro.config.*|next.config.*|remix.config.*|\
    webpack.config.*|rollup.config.*|babel.config.*|postcss.config.*|\
    tailwind.config.*|eslint.config.*|jest.config.*|vitest.config.*)
      return 0
      ;;
  esac
  return 1
}
