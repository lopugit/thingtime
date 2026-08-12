#!/usr/bin/env bash

# Prepare one stopped-rebase conflict set for a repo-less Claude scratch run.
# The real Git checkout must already live under RUNNER_TEMP, outside
# GITHUB_WORKSPACE. This trusted pre-model script validates the immutable Git
# state, resolves graphify output deterministically, clears the workspace, and
# copies only exact safe marker-bearing text conflicts into that scratch root.

set -euo pipefail
IFS=$'\n\t'

# EX_CONFIG: deterministic conflict policy says a human must review this exact
# snapshot. The composite action preserves the nonzero failure while exposing
# this classification to the promotion retry controller.
TERMINAL_REVIEW_EXIT=78

MAX_SOURCE_BYTES="${AI_REBASE_MAX_SOURCE_BYTES:-524288}"
MAX_AI_CONFLICT_FILES="${AI_REBASE_MAX_CONFLICT_FILES:-20}"
MAX_AI_ROUND_BYTES="${AI_REBASE_MAX_ROUND_BYTES:-2097152}"
MAX_TOTAL_CONFLICT_FILES="${AI_REBASE_MAX_TOTAL_CONFLICT_FILES:-200}"
MAX_CONFLICT_PATH_BYTES="${AI_REBASE_MAX_CONFLICT_PATH_BYTES:-16384}"
CONFLICT_POLICY="${AI_REBASE_CONFLICT_POLICY:-pr-rebase}"

case "$CONFLICT_POLICY" in
  pr-rebase|promotion) ;;
  *) echo "::error::Unknown AI rebase conflict policy."; exit 1 ;;
esac

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

# There is deliberately NO sensitive-path deny-list here. Owner decision
# (2026-08-12): the model may be shown any conflicted repo file. What still
# constrains a resolution: mechanical shape checks below (regular files,
# coherent markers, the size cap), the scope verifier (only recomputed
# conflicted paths may change), and publication gating — CI-sensitive and
# review-gated content ships [skip ci] with approval-required checks, so
# model-authored content in CI-executing files does not run before a human
# approves it. Do not reintroduce a path deny-list; the contract pins its
# absence.

has_coherent_zdiff3_markers() {
  # A bare ======= outside an active conflict is intentionally ignored: it is
  # valid Markdown. Repositories may raise conflict-marker-size above Git's
  # default seven via .gitattributes, so recognize homogeneous marker runs of
  # seven or more characters. A real zdiff3 block must have ordered
  # start/base/divider/end markers, and every opened block must close.
  awk '
    BEGIN { state = 0; blocks = 0; bad = 0 }
    function is_marker(ch,    i, n, tail) {
      n = length($0)
      for (i = 1; i <= n && substr($0, i, 1) == ch; i++) {}
      tail = substr($0, i, 1)
      return i - 1 >= 7 && (tail == "" || tail == " ")
    }
    is_marker("<") {
      if (state != 0) bad = 1
      state = 1
      next
    }
    is_marker("|") {
      if (state != 1) bad = 1
      state = 2
      next
    }
    is_marker("=") {
      if (state == 2) state = 3
      next
    }
    is_marker(">") {
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
    return "$TERMINAL_REVIEW_EXIT"
  fi
  if [[ ! -f "$path" || -L "$path" ]]; then
    echo "::error::Only existing regular-file conflicts are eligible for AI resolution: $path"
    return "$TERMINAL_REVIEW_EXIT"
  fi
  if (( $(wc -c <"$path") > MAX_SOURCE_BYTES * 3 )); then
    echo "::error::Conflict marker file is too large for AI resolution: $path"
    return "$TERMINAL_REVIEW_EXIT"
  fi
  if ! has_coherent_zdiff3_markers "$path"; then
    echo "::error::Conflict does not contain coherent zdiff3 markers: $path"
    return "$TERMINAL_REVIEW_EXIT"
  fi

  blob_tmp="$(mktemp)"
  stage_count=0
  while IFS=' ' read -r mode oid _; do
    [[ -n "$mode" ]] || continue
    ((stage_count += 1))
    if [[ "$mode" != 100644 ]]; then
      echo "::error::Symlink, submodule, executable, or non-regular conflict requires human review: $path (mode $mode)"
      rm -f -- "$blob_tmp"
      return "$TERMINAL_REVIEW_EXIT"
    fi
    stage_size="$(git cat-file -s "$oid")"
    if (( stage_size > MAX_SOURCE_BYTES )); then
      echo "::error::Conflict source blob is too large for AI resolution: $path ($stage_size bytes)"
      rm -f -- "$blob_tmp"
      return "$TERMINAL_REVIEW_EXIT"
    fi
    git cat-file blob "$oid" >"$blob_tmp"
    if [[ -s "$blob_tmp" ]] && ! LC_ALL=C grep -Iq . "$blob_tmp"; then
      echo "::error::Binary conflict requires human review: $path"
      rm -f -- "$blob_tmp"
      return "$TERMINAL_REVIEW_EXIT"
    fi
  done < <(git ls-files -u -- ":(literal)$path" | awk '{ print $1, $2, $3 }')
  rm -f -- "$blob_tmp"
  if (( stage_count == 0 )); then
    echo "::error::No immutable index stages found for conflict: $path"
    return "$TERMINAL_REVIEW_EXIT"
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
      return "$TERMINAL_REVIEW_EXIT"
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

if [[ "${1:-}" == --self-test-policy ]]; then
  # The path deny-list was retired by owner decision (2026-08-12); there is no
  # path policy left to exercise. Green stub so any caller pinned to this flag
  # keeps passing.
  echo "prepare-round promotion path policy: retired (no deny-list)"
  exit 0
fi

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
trap 'rm -f -- "$all_conflicts" "$ai_conflicts"' EXIT
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
  exit "$TERMINAL_REVIEW_EXIT"
fi

graphify_reset=false
ai_round_bytes=0
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  if unsafe_path_syntax "$path"; then
    echo "::error::Unsafe conflict path syntax: $path"
    exit "$TERMINAL_REVIEW_EXIT"
  fi
  case "$path" in
    graphify-out/*)
      graphify_reset=true
      ;;
    *)
      # Keep this as a direct simple command: errexit must remain active inside
      # the validator so an immutable-object read failure cannot be ignored.
      # Explicit closed-policy returns are already terminal-review exit 78.
      assert_safe_regular_text_conflict "$path"
      ai_round_bytes=$((ai_round_bytes + $(wc -c <"$path")))
      if (( ai_round_bytes > MAX_AI_ROUND_BYTES )); then
        echo "::error::Model-editable conflict input is $ai_round_bytes bytes; the per-round aggregate cap is $MAX_AI_ROUND_BYTES. Human review is required."
        exit "$TERMINAL_REVIEW_EXIT"
      fi
      printf '%s\n' "$path" >>"$ai_conflicts"
      ;;
  esac
done <"$all_conflicts"

ai_conflict_count="$(wc -l <"$ai_conflicts")"
if (( ai_conflict_count > MAX_AI_CONFLICT_FILES )); then
  echo "::error::Conflict set has $ai_conflict_count model-editable files; the per-round cap is $MAX_AI_CONFLICT_FILES."
  exit "$TERMINAL_REVIEW_EXIT"
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
