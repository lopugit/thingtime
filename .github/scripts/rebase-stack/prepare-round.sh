#!/usr/bin/env bash

# Prepare one stopped-rebase conflict set for a repo-less Claude scratch run.
# The real Git checkout must already live under RUNNER_TEMP, outside
# GITHUB_WORKSPACE. This trusted pre-model script validates the immutable Git
# state, resolves graphify output deterministically, clears the workspace, and
# copies only exact safe marker-bearing text conflicts into that scratch root.

set -euo pipefail
IFS=$'\n\t'

MAX_SOURCE_BYTES="${AI_REBASE_MAX_SOURCE_BYTES:-524288}"
MAX_AI_CONFLICT_FILES="${AI_REBASE_MAX_CONFLICT_FILES:-20}"
MAX_AI_ROUND_BYTES="${AI_REBASE_MAX_ROUND_BYTES:-2097152}"
MAX_TOTAL_CONFLICT_FILES="${AI_REBASE_MAX_TOTAL_CONFLICT_FILES:-200}"
MAX_CONFLICT_PATH_BYTES="${AI_REBASE_MAX_CONFLICT_PATH_BYTES:-16384}"

emit() {
  printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
}

emit_paths() {
  local name file delimiter
  name="$1"
  file="$2"
  delimiter="REBASE_PATHS_${RANDOM}_$$_$(date +%s)"
  {
    printf '%s<<%s\n' "$name" "$delimiter"
    cat -- "$file"
    printf '%s\n' "$delimiter"
  } >>"$GITHUB_OUTPUT"
}

secure_git_environment() {
  export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_SYSTEM=/dev/null
  export GIT_CONFIG_NOSYSTEM=1
  export GIT_ATTR_NOSYSTEM=1
  export GIT_CONFIG_COUNT=2
  export GIT_CONFIG_KEY_0=core.hooksPath
  export GIT_CONFIG_VALUE_0=/dev/null
  export GIT_CONFIG_KEY_1=core.fsmonitor
  export GIT_CONFIG_VALUE_1=false
}

rebase_in_progress() {
  [[ -d "$git_dir/rebase-merge" || -d "$git_dir/rebase-apply" ]]
}

unsafe_path_syntax() {
  local path="$1"
  [[ -z "$path" || "$path" == /* || "$path" == .. || "$path" == ../* || "$path" == */../* || "$path" == */.. ]] \
    && return 0
  [[ "$path" =~ [[:cntrl:]] ]]
}

review_sensitive_path() {
  local path="$1"
  local base="${path##*/}"
  case "$path" in
    .github/*|*/.github/*|\
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

has_coherent_zdiff3_markers() {
  # A bare ======= outside an active conflict is intentionally ignored: it is
  # valid Markdown. A real zdiff3 block must have ordered start/base/divider/end
  # markers, and every opened block must close.
  awk '
    BEGIN { state = 0; blocks = 0; bad = 0 }
    /^<<<<<<<( |$)/ {
      if (state != 0) bad = 1
      state = 1
      next
    }
    /^\|\|\|\|\|\|\|( |$)/ {
      if (state != 1) bad = 1
      state = 2
      next
    }
    /^=======$/ {
      if (state == 2) state = 3
      next
    }
    /^>>>>>>>( |$)/ {
      if (state != 3) bad = 1
      else {
        state = 0
        blocks++
      }
      next
    }
    END { exit (bad || state != 0 || blocks == 0) }
  ' "$1"
}

assert_safe_regular_text_conflict() {
  local path="$1"
  local mode oid stage_size blob_tmp stage_count

  if unsafe_path_syntax "$path"; then
    echo "::error::Unsafe conflict path syntax: $path"
    return 1
  fi
  if [[ ! -f "$path" || -L "$path" ]]; then
    echo "::error::Only existing regular-file conflicts are eligible for AI resolution: $path"
    return 1
  fi
  if (( $(wc -c <"$path") > MAX_SOURCE_BYTES * 3 )); then
    echo "::error::Conflict marker file is too large for AI resolution: $path"
    return 1
  fi
  if ! has_coherent_zdiff3_markers "$path"; then
    echo "::error::Conflict does not contain coherent zdiff3 markers: $path"
    return 1
  fi

  blob_tmp="$(mktemp)"
  stage_count=0
  while IFS=' ' read -r mode oid _; do
    [[ -n "$mode" ]] || continue
    ((stage_count += 1))
    if [[ "$mode" != 100644 ]]; then
      echo "::error::Symlink, submodule, executable, or non-regular conflict requires human review: $path (mode $mode)"
      rm -f -- "$blob_tmp"
      return 1
    fi
    stage_size="$(git cat-file -s "$oid")"
    if (( stage_size > MAX_SOURCE_BYTES )); then
      echo "::error::Conflict source blob is too large for AI resolution: $path ($stage_size bytes)"
      rm -f -- "$blob_tmp"
      return 1
    fi
    git cat-file blob "$oid" >"$blob_tmp"
    if [[ -s "$blob_tmp" ]] && ! LC_ALL=C grep -Iq . "$blob_tmp"; then
      echo "::error::Binary conflict requires human review: $path"
      rm -f -- "$blob_tmp"
      return 1
    fi
  done < <(git ls-files -u -- "$path" | awk '{ print $1, $2, $3 }')
  rm -f -- "$blob_tmp"
  if (( stage_count == 0 )); then
    echo "::error::No immutable index stages found for conflict: $path"
    return 1
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" | awk '{ print $1 }'
  else
    shasum -a 256 -- "$1" | awk '{ print $1 }'
  fi
}

sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{ print $1 }'
  else
    shasum -a 256 | awk '{ print $1 }'
  fi
}

hash_rebase_state() {
  local state_dir
  if [[ -d "$git_dir/rebase-merge" ]]; then
    state_dir="$git_dir/rebase-merge"
  elif [[ -d "$git_dir/rebase-apply" ]]; then
    state_dir="$git_dir/rebase-apply"
  else
    return 1
  fi
  (
    builtin cd -- "$state_dir"
    while IFS= read -r -d '' state_file; do
      printf '%s\0' "$state_file"
      sha256_file "$state_file"
    done < <(find . -type f -print0 | LC_ALL=C sort -z)
  ) | sha256_stdin
}

write_unmerged_paths() {
  local output="$1"
  : >"$output"
  while IFS= read -r -d '' path; do
    if [[ "$path" =~ [[:cntrl:]] ]]; then
      echo "::error::Control characters in conflict paths are not supported."
      return 1
    fi
    printf '%s\n' "$path" >>"$output"
  done < <(git diff --name-only --diff-filter=U -z)
  LC_ALL=C sort -u -o "$output" "$output"
}

clear_scratch() {
  local scratch="$1"
  [[ -n "$scratch" && "$scratch" != / && "$scratch" != "$HOME" ]] || {
    echo "::error::Refusing unsafe scratch cleanup target: $scratch"
    return 1
  }
  find "$scratch" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
}

[[ $# -eq 3 ]] || {
  echo "usage: $0 <real-repo-path> <workspace-scratch-path> <safe-round-dir>" >&2
  exit 64
}
[[ -n "${GITHUB_OUTPUT:-}" && -n "${RUNNER_TEMP:-}" && -n "${GITHUB_WORKSPACE:-}" ]] || {
  echo "::error::GITHUB_OUTPUT, RUNNER_TEMP, and GITHUB_WORKSPACE are required."
  exit 1
}

secure_git_environment
repo_abs="$(builtin cd -- "$1" && pwd -P)"
scratch_abs="$(builtin cd -- "$2" && pwd -P)"
round_abs="$(builtin cd -- "$3" && pwd -P)"
runner_temp_abs="$(builtin cd -- "$RUNNER_TEMP" && pwd -P)"
workspace_abs="$(builtin cd -- "$GITHUB_WORKSPACE" && pwd -P)"

[[ "$scratch_abs" == "$workspace_abs" ]] || {
  echo "::error::Scratch must be the exact GITHUB_WORKSPACE directory."
  exit 1
}
case "$repo_abs/" in
  "$runner_temp_abs/"*) ;;
  *) echo "::error::The real Git checkout must live under RUNNER_TEMP."; exit 1 ;;
esac
case "$round_abs/" in
  "$runner_temp_abs/"*) ;;
  *) echo "::error::The trusted round copy must live under RUNNER_TEMP."; exit 1 ;;
esac
case "$repo_abs/" in
  "$workspace_abs/"*) echo "::error::The real Git checkout must be outside GITHUB_WORKSPACE."; exit 1 ;;
esac
[[ "$repo_abs" != "$round_abs" && "$scratch_abs" != "$round_abs" ]] || {
  echo "::error::Real repo, scratch, and trusted round paths must be distinct."
  exit 1
}

builtin cd -- "$repo_abs"
git rev-parse --is-inside-work-tree >/dev/null
git_dir="$(git rev-parse --absolute-git-dir)"

if ! rebase_in_progress || ! git rev-parse --verify --quiet "REBASE_HEAD^{commit}" >/dev/null; then
  echo "::error::No stopped rebase with REBASE_HEAD is present."
  exit 1
fi
if git config --local --name-only --get-regexp \
  '^(merge|filter|diff)\.[^.]+\.(driver|clean|smudge|process|textconv|command)$' >/dev/null 2>&1; then
  echo "::error::Unexpected executable Git driver is configured locally."
  exit 1
fi

all_conflicts="$(mktemp)"
ai_conflicts="$(mktemp)"
sensitive_conflicts="$(mktemp)"
trap 'rm -f -- "$all_conflicts" "$ai_conflicts" "$sensitive_conflicts"' EXIT
write_unmerged_paths "$all_conflicts"
if [[ ! -s "$all_conflicts" ]]; then
  echo "::error::The rebase is stopped but no unmerged paths are present."
  exit 1
fi
total_conflict_count="$(wc -l <"$all_conflicts")"
conflict_path_bytes="$(wc -c <"$all_conflicts")"
if (( total_conflict_count > MAX_TOTAL_CONFLICT_FILES \
      || conflict_path_bytes > MAX_CONFLICT_PATH_BYTES )); then
  echo "::error::Conflict path set exceeds the safe workflow-output cap ($total_conflict_count files, $conflict_path_bytes bytes). Human review is required."
  exit 1
fi

graphify_reset=false
ai_round_bytes=0
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  if unsafe_path_syntax "$path"; then
    echo "::error::Unsafe conflict path syntax: $path"
    exit 1
  fi
  case "$path" in
    graphify-out/*)
      graphify_reset=true
      ;;
    *)
      assert_safe_regular_text_conflict "$path"
      # Path sensitivity is reviewer context, never an eligibility gate. The
      # verifier records this path in the cross-round audit only after the
      # resolution is accepted and rebase --continue demonstrably advances.
      if review_sensitive_path "$path"; then
        printf '%s\n' "$path" >>"$sensitive_conflicts"
      fi
      ai_round_bytes=$((ai_round_bytes + $(wc -c <"$path")))
      if (( ai_round_bytes > MAX_AI_ROUND_BYTES )); then
        echo "::error::Model-editable conflict input is $ai_round_bytes bytes; the per-round aggregate cap is $MAX_AI_ROUND_BYTES. Human review is required."
        exit 1
      fi
      printf '%s\n' "$path" >>"$ai_conflicts"
      ;;
  esac
done <"$all_conflicts"
LC_ALL=C sort -u -o "$sensitive_conflicts" "$sensitive_conflicts"

ai_conflict_count="$(wc -l <"$ai_conflicts")"
if (( ai_conflict_count > MAX_AI_CONFLICT_FILES )); then
  echo "::error::Conflict set has $ai_conflict_count model-editable files; the per-round cap is $MAX_AI_CONFLICT_FILES."
  exit 1
fi

if [[ "$graphify_reset" == true ]]; then
  git rm -rfq --ignore-unmatch -- graphify-out/
  if git rev-parse --verify --quiet HEAD:graphify-out >/dev/null; then
    git checkout -q HEAD -- graphify-out/
  fi
fi

head_sha="$(git rev-parse "HEAD^{commit}")"
rebase_head_sha="$(git rev-parse "REBASE_HEAD^{commit}")"
rebase_parent_sha="$(git rev-parse "REBASE_HEAD^1^{commit}")"
index_path="$(git rev-parse --git-path index)"
index_sha256="$(sha256_file "$index_path")"
rebase_state_sha256="$(hash_rebase_state)"

# The local action is already parsed and its trusted files have been copied to
# round_abs. Remove every workspace entry, including the full trusted checkout,
# before Claude starts. Then expose only the exact AI-eligible conflicts.
clear_scratch "$scratch_abs"
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  target="$scratch_abs/$path"
  mkdir -p -- "$(dirname -- "$target")"
  cp -p -- "$repo_abs/$path" "$target"
  chmod 0644 "$target"
done <"$ai_conflicts"

emit repo_abs "$repo_abs"
emit scratch_abs "$scratch_abs"
emit round_abs "$round_abs"
emit needs_ai "$([[ -s "$ai_conflicts" ]] && echo true || echo false)"
emit graphify_reset "$graphify_reset"
emit head_sha "$head_sha"
emit rebase_head_sha "$rebase_head_sha"
emit rebase_parent_sha "$rebase_parent_sha"
emit index_sha256 "$index_sha256"
emit rebase_state_sha256 "$rebase_state_sha256"
emit_paths conflict_paths "$all_conflicts"
emit_paths ai_conflict_paths "$ai_conflicts"
emit_paths sensitive_conflict_paths "$sensitive_conflicts"
