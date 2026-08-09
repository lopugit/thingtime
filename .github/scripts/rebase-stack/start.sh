#!/usr/bin/env bash

# Start one trusted, non-interactive rebase. The caller must run this script
# before any model is given access to the checkout. A conflict is an expected
# output; every other kind of rebase stop is a hard failure.

set -euo pipefail
IFS=$'\n\t'

MAX_TOTAL_CONFLICT_FILES="${AI_REBASE_MAX_TOTAL_CONFLICT_FILES:-200}"
MAX_CONFLICT_PATH_BYTES="${AI_REBASE_MAX_CONFLICT_PATH_BYTES:-16384}"

usage() {
  echo "usage: $0 <repo-path> <root|onto> <base-sha> [<old-base-sha> <new-base-sha>]" >&2
  exit 64
}

emit() {
  local name="$1"
  local value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$name" "$value" >>"$GITHUB_OUTPUT"
  else
    printf '%s=%s\n' "$name" "$value"
  fi
}

emit_paths() {
  local name file delimiter
  name="$1"
  file="$2"
  delimiter="REBASE_PATHS_${RANDOM}_$$_$(date +%s)"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      printf '%s<<%s\n' "$name" "$delimiter"
      cat -- "$file"
      printf '%s\n' "$delimiter"
    } >>"$GITHUB_OUTPUT"
  else
    printf '%s:\n' "$name"
    cat -- "$file"
  fi
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
  export GIT_EDITOR=true
  export GIT_SEQUENCE_EDITOR=true
}

rebase_in_progress() {
  [[ -d "$git_dir/rebase-merge" || -d "$git_dir/rebase-apply" ]]
}

write_conflicts() {
  local output="$1" count path_bytes
  : >"$output"
  while IFS= read -r -d '' path; do
    if [[ "$path" =~ [[:cntrl:]] ]]; then
      echo "::error::Control characters in conflict paths are not supported."
      return 1
    fi
    printf '%s\n' "$path" >>"$output"
  done < <(git diff --name-only --diff-filter=U -z)
  LC_ALL=C sort -u -o "$output" "$output"
  count="$(wc -l <"$output")"
  path_bytes="$(wc -c <"$output")"
  if (( count > MAX_TOTAL_CONFLICT_FILES \
        || path_bytes > MAX_CONFLICT_PATH_BYTES )); then
    echo "::error::Conflict path set exceeds the safe workflow-output cap ($count files, $path_bytes bytes)."
    return 1
  fi
}

[[ $# -ge 3 ]] || usage
repo_path="$1"
mode="$2"
base_input="$3"

case "$mode" in
  root)
    [[ $# -eq 3 ]] || usage
    ;;
  onto)
    [[ $# -eq 5 ]] || usage
    old_base_input="$4"
    new_base_input="$5"
    ;;
  *) usage ;;
esac

secure_git_environment
repo_abs="$(builtin cd -- "$repo_path" && pwd -P)"
builtin cd -- "$repo_abs"
git rev-parse --is-inside-work-tree >/dev/null
git_dir="$(git rev-parse --absolute-git-dir)"

if rebase_in_progress; then
  echo "::error::A rebase is already in progress; refusing to start another one."
  exit 1
fi

if [[ -n "$(git status --porcelain=v1 --untracked-files=no)" ]]; then
  echo "::error::The tracked worktree is not clean before rebase."
  exit 1
fi

base_sha="$(git rev-parse --verify "$base_input^{commit}")"
original_head="$(git rev-parse --verify "HEAD^{commit}")"
git config --local merge.conflictStyle zdiff3

status=0
if [[ "$mode" == root ]]; then
  git rebase "$base_sha" "$original_head" || status=$?
else
  old_base_sha="$(git rev-parse --verify "$old_base_input^{commit}")"
  new_base_sha="$(git rev-parse --verify "$new_base_input^{commit}")"
  if [[ "$new_base_sha" != "$base_sha" ]]; then
    echo "::error::The onto destination must equal the exact live base SHA ($base_sha)."
    exit 1
  fi
  if ! git merge-base --is-ancestor "$old_base_sha" "$original_head"; then
    echo "::error::The supplied old parent $old_base_sha is not an ancestor of $original_head."
    exit 1
  fi
  git rebase --onto "$new_base_sha" "$old_base_sha" "$original_head" || status=$?
fi

conflicts_file="$(mktemp)"
trap 'rm -f -- "$conflicts_file"' EXIT

if [[ $status -eq 0 ]]; then
  if rebase_in_progress; then
    echo "::error::git rebase returned success but left rebase state behind."
    exit 1
  fi
  : >"$conflicts_file"
  emit complete true
  emit conflicted false
  emit_paths conflict_paths "$conflicts_file"
  exit 0
fi

write_conflicts "$conflicts_file"
if rebase_in_progress \
  && git rev-parse --verify --quiet "REBASE_HEAD^{commit}" >/dev/null \
  && [[ -s "$conflicts_file" ]]; then
  echo "Rebase stopped on conflicts:"
  sed 's/^/  - /' "$conflicts_file"
  emit complete false
  emit conflicted true
  emit_paths conflict_paths "$conflicts_file"
  exit 0
fi

echo "::error::git rebase stopped without a resolvable conflict set (exit $status)."
git rebase --abort >/dev/null 2>&1 || true
exit "$status"
