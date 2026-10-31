#!/usr/bin/env bash

# Regenerate derived Graphify outputs after a promotion source commit has been
# mechanically verified. This runs after the model boundary, in the isolated
# real checkout, and never changes the authorized source tree.

set -euo pipefail
IFS=$'\n\t'

fail() {
  echo "::error::$*" >&2
  exit 1
}

emit() {
  printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
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

current_refs_hash() {
  git for-each-ref --format='%(refname) %(objectname) %(objecttype)' \
    | LC_ALL=C sort | sha256_stdin
}

current_grafts_state() {
  local path
  path="$(git rev-parse --git-path info/grafts)"
  if [[ -f "$path" ]]; then
    printf 'file:%s\n' "$(sha256_file "$path")"
  elif [[ -e "$path" ]]; then
    printf 'unexpected\n'
  else
    printf 'missing\n'
  fi
}

snapshot_tool_boundary() {
  local config_path
  config_path="$(git rev-parse --git-path config)"
  [[ -f "$config_path" ]] || fail "Isolated checkout lacks a regular local Git config."
  expected_config_sha="$(sha256_file "$config_path")"
  expected_refs_sha="$(current_refs_hash)"
  expected_grafts_state="$(current_grafts_state)"
  expected_symbolic_head="$(git symbolic-ref -q HEAD 2>/dev/null || true)"
}

assert_control_metadata_unchanged() {
  local config_path
  config_path="$(git rev-parse --git-path config)"
  [[ -f "$config_path" && "$(sha256_file "$config_path")" == "$expected_config_sha" ]] \
    || fail "Graphify tooling changed the isolated checkout's local Git config."
  [[ "$(current_refs_hash)" == "$expected_refs_sha" ]] \
    || fail "Graphify tooling changed a Git ref in the isolated checkout."
  [[ "$(current_grafts_state)" == "$expected_grafts_state" ]] \
    || fail "Graphify tooling changed Git graft history."
  [[ "$(git symbolic-ref -q HEAD 2>/dev/null || true)" == "$expected_symbolic_head" ]] \
    || fail "Graphify tooling changed detached/symbolic HEAD state."
}

assert_tool_boundary() {
  assert_control_metadata_unchanged
  [[ "$(git rev-parse HEAD)" == "$verified_head" ]] \
    || fail "Graphify tooling changed the mechanically verified promotion HEAD."
  [[ "$(git rev-parse "$verified_head^{tree}")" == "$verified_tree" ]] \
    || fail "Graphify tooling changed the verified promotion tree identity."
  [[ "$(git cat-file commit "$verified_head" | git hash-object -t commit --stdin)" == "$verified_head" ]] \
    || fail "Graphify tooling corrupted the verified promotion commit object."
}

verify_derived_commit() {
  local derived_head parent_line parent_count parent changed_file changed_count
  derived_head="$(git rev-parse HEAD)"
  assert_control_metadata_unchanged
  parent_line="$(git rev-list --parents -n 1 "$derived_head")"
  parent_count="$(awk '{ print NF - 1 }' <<<"$parent_line")"
  parent="$(awk '{ print $2 }' <<<"$parent_line")"
  [[ "$parent_count" = 1 && "$parent" == "$verified_head" ]] \
    || fail "Derived Graphify commit is not a single-parent child of the verified source head."
  [[ "$(git rev-list --count "$verified_head..$derived_head")" = 1 ]] \
    || fail "Derived Graphify history contains more than its one authorized commit."
  changed_count=0
  while IFS= read -r -d '' changed_file; do
    ((changed_count += 1))
    case "$changed_file" in
      graphify-out/graph.json|graphify-out/GRAPH_REPORT.md|\
      graphify-out/manifest.json|graphify-out/cost.json|\
      graphify-out/cache/semantic/*) ;;
      *) fail "Derived Graphify commit changed an unauthorized path: $changed_file" ;;
    esac
  done < <(git diff --name-only -z "$verified_head" "$derived_head")
  (( changed_count > 0 )) || fail "Derived Graphify commit contains no approved output change."
  git diff --quiet "$verified_head" "$derived_head" -- . ':(exclude)graphify-out/**' \
    || fail "Derived Graphify commit changed the verified source tree."
  git diff --quiet && git diff --cached --quiet \
    || fail "Derived Graphify commit left tracked worktree or index changes."
}

if [[ "${1:-}" == --self-test-history-boundary ]]; then
  test_root="$(mktemp -d)"
  trap 'rm -rf -- "$test_root"' EXIT
  test_repo="$test_root/repo"
  mkdir -p "$test_repo" "$test_root/run"
  git -C "$test_repo" init -q
  git -C "$test_repo" config user.name fixture
  git -C "$test_repo" config user.email fixture@example.invalid
  mkdir -p "$test_repo/graphify-out"
  printf 'source\n' >"$test_repo/source.txt"
  printf '{"nodes":[]}\n' >"$test_repo/graphify-out/graph.json"
  git -C "$test_repo" add source.txt graphify-out/graph.json
  git -C "$test_repo" commit -qm verified
  export RUNNER_TEMP="$test_root/run"
  builtin cd -- "$test_repo"
  git switch -q --detach HEAD
  verified_head="$(git rev-parse HEAD)"
  verified_tree="$(git rev-parse 'HEAD^{tree}')"
  snapshot_tool_boundary

  git commit -q --allow-empty -m 'unexpected clean-tree history mutation'
  if (assert_tool_boundary) >/dev/null 2>&1; then
    echo 'clean-tree Graphify HEAD mutation unexpectedly passed' >&2
    exit 1
  fi
  git reset -q --hard "$verified_head"

  printf '{"nodes":[{"id":"derived"}]}\n' >graphify-out/graph.json
  git add graphify-out/graph.json
  git commit -qm 'authorized derived graph'
  verify_derived_commit

  git reset -q --hard "$verified_head"
  printf 'mutated source\n' >source.txt
  git add source.txt
  git commit -qm 'unauthorized source mutation'
  if (verify_derived_commit) >/dev/null 2>&1; then
    echo 'source-mutating derived commit unexpectedly passed' >&2
    exit 1
  fi
  echo 'promotion Graphify history boundary: self-test OK'
  exit 0
fi

[[ $# -eq 1 ]] || {
  echo "usage: $0 <isolated-repo-path>" >&2
  exit 64
}
for name in GITHUB_OUTPUT RUNNER_TEMP PLAN_HASH RUN_URL; do
  [[ -n "${!name:-}" ]] || fail "$name is required."
done
[[ "$PLAN_HASH" =~ ^[0-9a-f]{64}$ ]] || fail "PLAN_HASH must be a SHA-256."

repo_abs="$(builtin cd -- "$1" && pwd -P)"
runner_temp_abs="$(builtin cd -- "$RUNNER_TEMP" && pwd -P)"
case "$repo_abs/" in
  "$runner_temp_abs/"*) ;;
  *) fail "Graphify refresh checkout must live under RUNNER_TEMP." ;;
esac

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:$PATH"
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_ATTR_NOSYSTEM=1
export GIT_NO_REPLACE_OBJECTS=1
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=core.hooksPath
export GIT_CONFIG_VALUE_0=/dev/null
export GIT_CONFIG_KEY_1=core.fsmonitor
export GIT_CONFIG_VALUE_1=false

GRAPHIFY_VERSION="${GRAPHIFY_VERSION:-0.9.4}"
[ -n "${ANTHROPIC_API_KEY_FALLBACK:-}" ] || unset ANTHROPIC_API_KEY_FALLBACK
[ -n "${CLAUDE_CODE_OAUTH_TOKEN_FALLBACK:-}" ] || unset CLAUDE_CODE_OAUTH_TOKEN_FALLBACK
primary_anthropic_api_key="${ANTHROPIC_API_KEY:-}"
primary_claude_code_oauth_token="${CLAUDE_CODE_OAUTH_TOKEN:-}"
credential_slot="$(cat "$RUNNER_TEMP/lopu-claude-credential-slot" 2>/dev/null || printf 'primary')"
case "$credential_slot" in
  primary) ;;
  fallback)
    ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY_FALLBACK:-}"
    CLAUDE_CODE_OAUTH_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN_FALLBACK:-}"
    ;;
  *)
    echo "::warning::Invalid Lopu credential slot; Graphify will use its non-Claude fallback."
    unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN
    ;;
esac
[ -n "${OPENAI_API_KEY:-}" ] || unset OPENAI_API_KEY
[ -n "${ANTHROPIC_API_KEY:-}" ] || unset ANTHROPIC_API_KEY
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || unset CLAUDE_CODE_OAUTH_TOKEN

builtin cd -- "$repo_abs"
git rev-parse --is-inside-work-tree >/dev/null
verified_head="$(git rev-parse HEAD)"
verified_tree="$(git rev-parse 'HEAD^{tree}')"

# Restore exactly the verified commit before any parser sees the worktree.
git reset -q --hard "$verified_head"
git clean -qffdx
rm -rf -- graphify-out
git checkout -q "$verified_head" -- graphify-out/ 2>/dev/null || true
snapshot_tool_boundary

install_status=0
(pipx install "graphifyy==$GRAPHIFY_VERSION" >/dev/null 2>&1 \
  || pip install --user "graphifyy==$GRAPHIFY_VERSION" >/dev/null 2>&1) || install_status=$?
assert_tool_boundary
if (( install_status != 0 )); then
  echo "::warning::graphify $GRAPHIFY_VERSION could not be installed; preserving the exact promotion-base graph."
  emit semantic unavailable
  emit refreshed failed
  exit 0
fi
export PATH="$HOME/.local/bin:$PATH"

select_claude_backend() {
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    printf 'claude\n'
  elif [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    printf 'claude-cli\n'
  fi
}

backend=""
case "${GRAPHIFY_BACKEND_PREFERENCE:-claude}" in
  codex)
    if [ -n "${OPENAI_API_KEY:-}" ]; then
      backend=openai
    else
      backend="$(select_claude_backend)"
    fi
    ;;
  claude)
    backend="$(select_claude_backend)"
    if [ -z "$backend" ] && [ -n "${OPENAI_API_KEY:-}" ]; then
      backend=openai
    fi
    ;;
  *)
    echo "::warning::Unexpected Graphify backend preference; using the available credential fallback."
    backend="$(select_claude_backend)"
    if [ -z "$backend" ] && [ -n "${OPENAI_API_KEY:-}" ]; then
      backend=openai
    fi
    ;;
esac

if [ "$backend" = claude-cli ]; then
  if command -v claude >/dev/null 2>&1; then
    :
  else
    claude_install_status=0
    npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 || claude_install_status=$?
    assert_tool_boundary
    if (( claude_install_status == 0 )) && command -v claude >/dev/null 2>&1; then
      :
    else
      echo "::warning::claude CLI is unavailable; using the AST/text Graphify fallback."
      backend=""
    fi
  fi
fi

# The workflow supplies only closed, validated controller outputs. Force the
# selected provider's configured model; each provider's default sentinel
# intentionally leaves Graphify unforced.
graphify_model_args=()
case "$backend" in
  openai)
    unset GRAPHIFY_CLAUDE_CLI_MODEL
    case "${LOPU_OPENAI_MODEL:-default}" in
      default|'') unset GRAPHIFY_OPENAI_MODEL ;;
      gpt-5.6-terra|gpt-5.6-sol)
        graphify_model_args=(--model "$LOPU_OPENAI_MODEL")
        export GRAPHIFY_OPENAI_MODEL="$LOPU_OPENAI_MODEL"
        ;;
      *)
        echo "::warning::Unexpected Lopu OpenAI model; Graphify will use its built-in OpenAI default."
        unset GRAPHIFY_OPENAI_MODEL
        ;;
    esac
    ;;
  claude|claude-cli)
    unset GRAPHIFY_OPENAI_MODEL
    case "${PREFERRED_MODEL:-default}" in
      default) unset GRAPHIFY_CLAUDE_CLI_MODEL ;;
      claude-fable-5|claude-opus-5)
        graphify_model_args=(--model "$PREFERRED_MODEL")
        export GRAPHIFY_CLAUDE_CLI_MODEL="$PREFERRED_MODEL"
        ;;
      *)
        echo "::warning::Unexpected preferred Claude model; Graphify will use its built-in default."
        unset GRAPHIFY_CLAUDE_CLI_MODEL
        ;;
    esac
    ;;
esac

graph_not_collapsed() {
  local old_n new_n
  old_n="$(git show "$verified_head:graphify-out/graph.json" 2>/dev/null \
    | jq '.nodes | length' 2>/dev/null || echo 0)"
  new_n="$(jq '.nodes | length' graphify-out/graph.json 2>/dev/null || echo 0)"
  case "$old_n" in ''|*[!0-9]*) old_n=0 ;; esac
  case "$new_n" in ''|*[!0-9]*) new_n=0 ;; esac
  if [ "$old_n" -gt 0 ] && [ "$new_n" -lt $((old_n / 2)) ]; then
    echo "::warning::Semantic Graphify refresh shrank the graph ($old_n -> $new_n nodes); refusing it."
    return 1
  fi
}

semantic=none
if [ -n "$backend" ]; then
  concurrency=4
  [ "$backend" != claude-cli ] || concurrency=1
  semantic_status=0
  graphify extract . --backend "$backend" "${graphify_model_args[@]}" \
    --max-concurrency "$concurrency" --api-timeout 7200 \
    && graphify cluster-only . --no-viz --no-label \
    && graph_not_collapsed || semantic_status=$?
  assert_tool_boundary
  if (( semantic_status == 0 )); then
    semantic="$backend"
  else
    semantic=failed
    echo "::warning::Semantic Graphify extraction failed; restoring the verified graph before AST/text fallback."
    git checkout -q "$verified_head" -- graphify-out/ 2>/dev/null || true
    git clean -qffdx -- graphify-out/
  fi
fi
emit semantic "$semantic"

if [ "$semantic" = none ] || [ "$semantic" = failed ]; then
  update_status=0
  graphify update . || update_status=$?
  assert_tool_boundary
  if (( update_status != 0 )); then
    echo "::warning::AST/text Graphify refresh failed; preserving the exact promotion-base graph."
    git reset -q --hard "$verified_head"
    emit refreshed failed
    exit 0
  fi
fi
assert_tool_boundary

# Stage only portable, repo-tracked Graphify outputs.
for file in graph.json GRAPH_REPORT.md manifest.json cost.json; do
  path="graphify-out/$file"
  if [ -e "$path" ] || git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
    git add -A -- "$path"
  fi
done
if [ -d graphify-out/cache/semantic ] \
   || [ -n "$(git ls-files -- 'graphify-out/cache/semantic/')" ]; then
  git add -A -- graphify-out/cache/semantic/
fi

if [ -n "$(git status --porcelain --untracked-files=no -- . ':(exclude)graphify-out/')" ]; then
  echo "::error::Graphify modified source files; dropping the derived refresh."
  git reset -q --hard "$verified_head"
  emit refreshed failed
  exit 0
fi

# This step owns live LLM credentials and may stage parser/LLM-influenced
# derived bytes. Reject exact raw or base64 credential material before commit.
needles="$RUNNER_TEMP/promotion-graphify-needles.txt"
: >"$needles"
for secret in "${OPENAI_API_KEY:-}" "$primary_anthropic_api_key" \
  "$primary_claude_code_oauth_token" "${ANTHROPIC_API_KEY_FALLBACK:-}" \
  "${CLAUDE_CODE_OAUTH_TOKEN_FALLBACK:-}"; do
  [ -n "$secret" ] || continue
  printf '%s\n' "$secret" >>"$needles"
  printf '%s' "$secret" | base64 -w0 >>"$needles"
  printf '\n' >>"$needles"
done
if [ -s "$needles" ]; then
  staged="$RUNNER_TEMP/promotion-graphify-staged.txt"
  git -c core.quotePath=false diff --cached --name-only >"$staged"
  blob="$RUNNER_TEMP/promotion-graphify-staged-blob"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    git show ":$path" >"$blob" 2>/dev/null || true
    if grep -qFf "$needles" "$blob"; then
      echo "::error::Staged $path contains credential material; dropping the derived refresh."
      git reset -q --hard "$verified_head"
      rm -f -- "$blob" "$needles" "$staged"
      emit refreshed failed
      exit 0
    fi
  done <"$staged"
  rm -f -- "$blob" "$staged"
fi
rm -f -- "$needles"

if git diff --cached --quiet; then
  emit refreshed nochange
  exit 0
fi

case "$semantic" in
  openai|claude|claude-cli)
    detail="graphify extract with semantic $semantic backend; unchanged content reused the tracked cache" ;;
  failed)
    detail="semantic extraction failed; graphify update completed the AST/text fallback" ;;
  *)
    detail="graphify update completed without an available semantic credential" ;;
esac
commit_title='chore: refresh graphify outputs after promotion resolution'
git commit -q \
  -m "$commit_title" \
  -m "$detail" \
  -m "Thingtime-Promotion-Plan-Hash: $PLAN_HASH" \
  -m "Refreshed by the promotion conflict worker: $RUN_URL"
verify_derived_commit
emit refreshed true
