#!/usr/bin/env bash

# Trusted deterministic mechanics for the pre-PR promotion conflict worker.
# The caller owns GitHub API routing/publication. This script only materializes
# and verifies one exact aggregate source patch in an isolated real checkout.

set -euo pipefail
IFS=$'\n\t'

emit() {
  printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
}

emit_paths() {
  local name="$1" file="$2" delimiter
  delimiter="PROMOTION_PATHS_${RANDOM}_$$_$(date +%s)"
  {
    printf '%s<<%s\n' "$name" "$delimiter"
    cat -- "$file"
    printf '%s\n' "$delimiter"
  } >>"$GITHUB_OUTPUT"
}

fail() {
  echo "::error::$*" >&2
  exit 1
}

sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{ print $1 }'
  else
    shasum -a 256 | awk '{ print $1 }'
  fi
}

secure_git_environment() {
  export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
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

require_environment() {
  local name
  for name in \
    GITHUB_OUTPUT RUNNER_TEMP SOURCE_PR BASE_REF BASE_SHA PROMOTION_BRANCH \
    RESERVATION_SHA SOURCE_TIP_SHA SOURCE_START_SHA SOURCE_END_SHA \
    SOURCE_LINEAGE_STATUS PLAN_HASH RUN_URL; do
    [[ -n "${!name:-}" ]] || fail "$name is required."
  done
  [[ "$SOURCE_PR" =~ ^[1-9][0-9]*$ ]] || fail "SOURCE_PR must be a positive decimal number."
  [[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "BASE_SHA must be a full SHA-1."
  [[ "$RESERVATION_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "RESERVATION_SHA must be a full SHA-1."
  [[ "$SOURCE_START_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "SOURCE_START_SHA must be a full SHA-1."
  [[ "$SOURCE_TIP_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "SOURCE_TIP_SHA must be a full SHA-1."
  [[ "$SOURCE_END_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "SOURCE_END_SHA must be a full SHA-1."
  # NEVER CANCEL (owner decision, 2026-08-12): review-required lineage is
  # accepted and review-gates publication instead of refusing it. The set is
  # closed; anything else still fails.
  case "$SOURCE_LINEAGE_STATUS" in
    verified|review-required-removed|review-required-ambiguous) ;;
    *) fail "SOURCE_LINEAGE_STATUS must be verified, review-required-removed, or review-required-ambiguous; got '$SOURCE_LINEAGE_STATUS'." ;;
  esac
  [[ "$PLAN_HASH" =~ ^[0-9a-f]{64}$ ]] || fail "PLAN_HASH must be a SHA-256."
}

unsafe_path_syntax() {
  local path="$1"
  [[ -z "$path" || "$path" == /* || "$path" == .. || "$path" == ../* || "$path" == */../* || "$path" == */.. ]] \
    && return 0
  [[ "$path" =~ [[:cntrl:]] ]]
}

# Reproduce the promoter's source-tip classification from the exact aggregate
# patch in a temporary index. A caller cannot label a removed or ambiguous
# historical patch `verified`: the trusted worker independently observes the
# same forward/reverse applicability against immutable SOURCE_TIP_SHA and
# blocks before constructing the synthetic replay.
classify_source_lineage() {
  local repo="$1" patch_file="$2" index_file forward_status reverse_status
  index_file="$RUNNER_TEMP/promotion-lineage-index"
  rm -f -- "$index_file"
  builtin cd -- "$repo"
  GIT_INDEX_FILE="$index_file" git read-tree "$SOURCE_TIP_SHA" \
    || fail "Could not load the exact source-tip tree for lineage verification."

  forward_status=0
  GIT_INDEX_FILE="$index_file" git apply --cached --check --whitespace=nowarn "$patch_file" \
    >/dev/null 2>&1 || forward_status=$?
  reverse_status=0
  GIT_INDEX_FILE="$index_file" git apply --cached --check --reverse --whitespace=nowarn "$patch_file" \
    >/dev/null 2>&1 || reverse_status=$?
  rm -f -- "$index_file"

  case "$forward_status" in 0|1) ;; *) fail "Forward source-lineage check failed operationally (exit $forward_status)." ;; esac
  case "$reverse_status" in 0|1) ;; *) fail "Reverse source-lineage check failed operationally (exit $reverse_status)." ;; esac
  if (( reverse_status == 0 && forward_status != 0 )); then
    printf 'verified\n'
  elif (( forward_status == 0 && reverse_status != 0 )); then
    printf 'review-required-removed\n'
  else
    printf 'review-required-ambiguous\n'
  fi
}

write_plan() {
  local repo="$1" paths_file patch_file lineage_paths_file lineage_patch_file metadata_file
  local patch_id computed_hash path paths_json observed_lineage
  local -a planned_paths literal_pathspecs lineage_paths lineage_pathspecs
  paths_file="$RUNNER_TEMP/promotion-plan-paths.txt"
  patch_file="$RUNNER_TEMP/promotion-plan.patch"
  lineage_paths_file="$RUNNER_TEMP/promotion-lineage-paths.txt"
  lineage_patch_file="$RUNNER_TEMP/promotion-lineage.patch"
  metadata_file="$RUNNER_TEMP/promotion-plan.json"
  : >"$paths_file"

  builtin cd -- "$repo"
  git cat-file -e "$SOURCE_START_SHA^{commit}"
  git cat-file -e "$SOURCE_END_SHA^{commit}"
  git cat-file -e "$BASE_SHA^{commit}"
  git cat-file -e "$RESERVATION_SHA^{commit}"

  while IFS= read -r -d '' path; do
    unsafe_path_syntax "$path" && fail "Unsafe planned promotion path: $path"
    case "$path" in
      graphify-out/*) fail "Graphify paths must not enter the promotable source plan: $path" ;;
    esac
    printf '%s\n' "$path" >>"$paths_file"
  done < <(git diff --name-only -z "$SOURCE_START_SHA" "$SOURCE_END_SHA" -- . ':(exclude)graphify-out/**')
  LC_ALL=C sort -u -o "$paths_file" "$paths_file"

  [[ -s "$paths_file" ]] || fail "Promotion plan has no non-Graphify source paths."
  local path_count path_bytes
  path_count="$(wc -l <"$paths_file")"
  path_bytes="$(wc -c <"$paths_file")"
  (( path_count <= 200 && path_bytes <= 16384 )) \
    || fail "Promotion plan exceeds the safe path cap ($path_count paths, $path_bytes bytes)."

  mapfile -t planned_paths <"$paths_file"
  for path in "${planned_paths[@]}"; do
    literal_pathspecs+=(":(literal)$path")
  done
  git diff --binary --full-index "$SOURCE_START_SHA" "$SOURCE_END_SHA" -- "${literal_pathspecs[@]}" >"$patch_file"
  [[ -s "$patch_file" ]] || fail "Promotion plan produced an empty non-Graphify patch."
  (( $(wc -c <"$patch_file") <= 8388608 )) || fail "Promotion patch exceeds the 8 MiB deterministic cap."
  patch_id="$(git patch-id --stable <"$patch_file" | awk 'NR == 1 { print $1 }')"
  [[ "$patch_id" =~ ^[0-9a-f]{40}$|^[0-9a-f]{64}$ ]] \
    || fail "Git returned an invalid promotion patch identity."

  # Match the promoter's source-presence signal exactly. The aggregate
  # changelog is regenerated/combined independently and must not make an
  # otherwise provable feature look removed or ambiguous. If the changelog is
  # the only source path, it remains the patch being promoted.
  grep -vxF 'remix/CHANGELOG.md' "$paths_file" >"$lineage_paths_file" || true
  [[ -s "$lineage_paths_file" ]] || cp -- "$paths_file" "$lineage_paths_file"
  mapfile -t lineage_paths <"$lineage_paths_file"
  for path in "${lineage_paths[@]}"; do
    lineage_pathspecs+=(":(literal)$path")
  done
  git diff --binary --full-index "$SOURCE_START_SHA" "$SOURCE_END_SHA" \
    -- "${lineage_pathspecs[@]}" >"$lineage_patch_file"
  [[ -s "$lineage_patch_file" ]] || fail "Promotion lineage patch is empty."
  observed_lineage="$(classify_source_lineage "$repo" "$lineage_patch_file")"
  # The independent re-derivation must agree with the trusted handoff exactly —
  # both run against the immutable SOURCE_TIP_SHA, so any difference means a
  # forged or stale plan, never honest drift. A non-verified agreement is NOT a
  # refusal (never-cancel): it review-gates publication below instead.
  [[ "$observed_lineage" == "$SOURCE_LINEAGE_STATUS" ]] \
    || fail "Source-lineage classification differs from the trusted handoff ($observed_lineage != $SOURCE_LINEAGE_STATUS)."

  paths_json="$(jq -Rsc 'split("\n") | map(select(length > 0))' "$paths_file")"
  jq -cjn \
    --argjson source_pr "$SOURCE_PR" \
    --arg base_ref "$BASE_REF" \
    --arg base_sha "$BASE_SHA" \
    --arg branch "$PROMOTION_BRANCH" \
    --arg source_start_sha "$SOURCE_START_SHA" \
    --arg source_end_sha "$SOURCE_END_SHA" \
    --arg source_lineage_status "$SOURCE_LINEAGE_STATUS" \
    --argjson paths "$paths_json" \
    --arg patch_id "$patch_id" \
    '{v:1,source_pr:$source_pr,base_ref:$base_ref,base_sha:$base_sha,branch:$branch,source_start_sha:$source_start_sha,source_end_sha:$source_end_sha,source_lineage_status:$source_lineage_status,paths:$paths,patch_id:$patch_id}' \
    >"$metadata_file"
  computed_hash="$(sha256_stdin <"$metadata_file")"
  [[ "$computed_hash" == "$PLAN_HASH" ]] \
    || fail "Reconstructed promotion plan hash differs from the trusted handoff ($computed_hash != $PLAN_HASH)."

  printf '%s\n' "$patch_id" >"$RUNNER_TEMP/promotion-patch-id.txt"
  if grep -q '^\.github/' "$paths_file"; then
    printf 'true\n' >"$RUNNER_TEMP/promotion-ci-sensitive-paths.txt"
    emit ci_sensitive_paths true
  else
    printf 'false\n' >"$RUNNER_TEMP/promotion-ci-sensitive-paths.txt"
    emit ci_sensitive_paths false
  fi
  if grep -q '^\.github/workflows/' "$paths_file"; then
    printf 'true\n' >"$RUNNER_TEMP/promotion-workflow-paths.txt"
    emit workflow_paths true
  else
    printf 'false\n' >"$RUNNER_TEMP/promotion-workflow-paths.txt"
    emit workflow_paths false
  fi
  # Review-gate CI-sensitive content AND any promotion whose source lineage is
  # not proven: both publish with [skip ci] content commits and an
  # approval-required checkpoint, so nothing unreviewed executes or ships.
  if grep -q '^\.github/' "$paths_file" || [[ "$observed_lineage" != verified ]]; then
    printf 'true\n' >"$RUNNER_TEMP/promotion-review-gated.txt"
    emit review_gated true
  else
    printf 'false\n' >"$RUNNER_TEMP/promotion-review-gated.txt"
    emit review_gated false
  fi
  emit plan_hash "$computed_hash"
  emit patch_id "$patch_id"
  emit source_lineage_status "$observed_lineage"
  emit plan_path_count "$path_count"
  emit_paths plan_paths "$paths_file"
}

require_reservation() {
  local repo="$1" parent_count parent tree base_tree message expected count
  builtin cd -- "$repo"
  parent_count="$(git rev-list --parents -n 1 "$RESERVATION_SHA" | awk '{ print NF - 1 }')"
  [[ "$parent_count" = 1 ]] || fail "Reservation commit is not single-parent."
  parent="$(git rev-parse "$RESERVATION_SHA^1")"
  [[ "$parent" == "$BASE_SHA" ]] || fail "Reservation parent is not the exact promotion base."
  tree="$(git rev-parse "$RESERVATION_SHA^{tree}")"
  base_tree="$(git rev-parse "$BASE_SHA^{tree}")"
  [[ "$tree" == "$base_tree" ]] || fail "Reservation commit is not empty."
  message="$(git show -s --format=%B "$RESERVATION_SHA")"
  for expected in \
    'Thingtime-Promotion-Reservation: v1' \
    "Thingtime-Promotion-Source-PR: $SOURCE_PR" \
    "Thingtime-Promotion-Base-Ref: $BASE_REF" \
    "Thingtime-Promotion-Base-SHA: $BASE_SHA" \
    "Thingtime-Promotion-Branch: $PROMOTION_BRANCH" \
    "Thingtime-Promotion-Source-Start-SHA: $SOURCE_START_SHA" \
    "Thingtime-Promotion-Source-End-SHA: $SOURCE_END_SHA" \
    "Thingtime-Promotion-Source-Lineage: $SOURCE_LINEAGE_STATUS" \
    "Thingtime-Promotion-Plan-Hash: $PLAN_HASH"; do
    count="$(grep -Fxc -- "$expected" <<<"$message" || true)"
    [[ "$count" = 1 ]] || fail "Reservation provenance is missing or duplicates: $expected"
  done
}

prepare() {
  local repo="$1" patch_file paths_file patch_id synthetic_head rebase_status conflict_file commit_title
  write_plan "$repo"
  require_reservation "$repo"
  patch_file="$RUNNER_TEMP/promotion-plan.patch"
  paths_file="$RUNNER_TEMP/promotion-plan-paths.txt"
  patch_id="$(<"$RUNNER_TEMP/promotion-patch-id.txt")"
  conflict_file="$RUNNER_TEMP/promotion-conflict-paths.txt"
  : >"$conflict_file"

  builtin cd -- "$repo"
  git switch -q --detach "$SOURCE_START_SHA"
  git reset -q --hard "$SOURCE_START_SHA"
  git clean -qffdx
  git apply --index --whitespace=nowarn "$patch_file"
  git -c core.quotePath=false diff --cached --name-only \
    | LC_ALL=C sort -u >"$RUNNER_TEMP/promotion-staged-paths.txt"
  cmp -s "$paths_file" "$RUNNER_TEMP/promotion-staged-paths.txt" \
    || fail "Synthetic source commit does not change the exact planned path set."

  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  commit_title="Promote source PR #$SOURCE_PR onto $BASE_REF"
  if [[ "$(<"$RUNNER_TEMP/promotion-review-gated.txt")" == true ]]; then
    commit_title="$commit_title [skip ci]"
  fi
  git commit -q \
    -m "$commit_title" \
    -m "Thingtime-Promotion-Source-PR: $SOURCE_PR" \
    -m "Thingtime-Promotion-Base-Ref: $BASE_REF" \
    -m "Thingtime-Promotion-Base-SHA: $BASE_SHA" \
    -m "Thingtime-Promotion-Branch: $PROMOTION_BRANCH" \
    -m "Thingtime-Promotion-Source-Tip-SHA: $SOURCE_TIP_SHA" \
    -m "Thingtime-Promotion-Source-Start-SHA: $SOURCE_START_SHA" \
    -m "Thingtime-Promotion-Source-End-SHA: $SOURCE_END_SHA" \
    -m "Thingtime-Promotion-Source-Lineage: $SOURCE_LINEAGE_STATUS" \
    -m "Thingtime-Promotion-Plan-Hash: $PLAN_HASH" \
    -m "Thingtime-Promotion-Patch-ID: $patch_id" \
    -m "Resolved by the promotion worker: $RUN_URL"
  synthetic_head="$(git rev-parse HEAD)"

  git config merge.conflictStyle zdiff3
  rebase_status=0
  git rebase --onto "$RESERVATION_SHA" "$SOURCE_START_SHA" "$synthetic_head" || rebase_status=$?
  deterministic_file="$RUNNER_TEMP/promotion-deterministic-paths.txt"
  : >"$deterministic_file"
  # Evidence, not judgment: every deterministic resolution discards or
  # overrides base-side work the source patch's author never saw. The machine
  # must not decide whether that work was superseded — but it can name it, so
  # the reviewer's release decision is informed. Listed per path in the
  # promotion PR's review comment; commits come from this repo's own history,
  # no model involved.
  discarded_file="$RUNNER_TEMP/promotion-discarded-changes.md"
  : >"$discarded_file"
  note_discarded() {
    local path="$1" verb="$2" base_commits
    base_commits="$(git log --format='%h %s' -n 20 \
      "$SOURCE_START_SHA..$BASE_SHA" -- ":(literal)$path" 2>/dev/null || true)"
    [[ -n "$base_commits" ]] || return 0
    {
      printf -- '- `%s` — %s. Base-side commits affected:\n' "$path" "$verb"
      printf '%s\n' "$base_commits" | sed 's/^/  - /'
    } >>"$discarded_file"
  }
  # Delete-shaped conflicts (a deletion on either side) carry no zdiff3
  # markers, so the AI round rightly refuses them — there is no merged text
  # for a model to edit. They are also the one conflict shape with a
  # deterministic answer: a promotion replays the source patch, so the
  # patch's intent wins. Where the patch deleted a file the base modified,
  # the file goes; where the base deleted a file the patch still changes,
  # the patch's content stays. During this rebase THEIRS is the synthetic
  # source commit. Two-sided content conflicts still go to the model, and
  # shapes neither rule covers (symlink or mode conflicts) still
  # terminal-review inside the round. First observed on #211, whose
  # control-plane conversion deletes .github/scripts/* files main had since
  # modified — every conflict was delete-shaped and the round refused them.
  # Materialize the unmerged set BEFORE mutating the index. The loop body
  # takes index.lock (git rm / git checkout --theirs); streaming from a live
  # `git diff` process substitution raced it at #211 scale (1481 conflicted
  # paths): git diff opportunistically refreshes the index, and its lock
  # collided with the consumer's -- "Unable to create .git/index.lock: File
  # exists" (exit 128). A completed snapshot leaves exactly one git process
  # alive at a time.
  unmerged_file="$RUNNER_TEMP/promotion-unmerged-paths.zlist"
  git diff --name-only --diff-filter=U -z >"$unmerged_file"
  while IFS= read -r -d '' path; do
    unsafe_path_syntax "$path" && fail "Unsafe rebase conflict path: $path"
    grep -qxF -- "$path" "$paths_file" || fail "Rebase conflicted outside the planned source paths: $path"
    stages="$(git ls-files -u -- ":(literal)$path" | awk '{ print $3 }' | LC_ALL=C sort -u | tr '\n' ' ')"
    if [[ "$stages" == *3* && "$stages" == *2* ]]; then
      printf '%s\n' "$path" >>"$conflict_file"
    elif [[ "$stages" == *3* ]]; then
      git checkout -q --theirs -- ":(literal)$path"
      git add -- ":(literal)$path"
      printf '%s\n' "$path" >>"$deterministic_file"
      note_discarded "$path" "the base deleted this file; the source patch restores or changes it, overriding that deletion"
    else
      git rm -q -f -- ":(literal)$path"
      printf '%s\n' "$path" >>"$deterministic_file"
      note_discarded "$path" "deleted by the source patch; the base had modified it since the patch was authored"
    fi
  done <"$unmerged_file"
  LC_ALL=C sort -u -o "$conflict_file" "$conflict_file"
  LC_ALL=C sort -u -o "$deterministic_file" "$deterministic_file"
  emit_paths deterministic_conflict_paths "$deterministic_file"

  if (( rebase_status == 0 )); then
    [[ ! -s "$conflict_file" ]] || fail "Rebase succeeded while leaving unresolved paths."
    emit conflicted false
    emit complete true
    emit head_sha "$(git rev-parse HEAD)"
    emit_paths conflict_paths "$conflict_file"
    return 0
  fi
  if [[ ! -s "$conflict_file" ]] && [[ ! -s "$deterministic_file" ]]; then
    fail "Synthetic rebase failed without a conflict set (exit $rebase_status)."
  fi
  git rev-parse --verify --quiet 'REBASE_HEAD^{commit}' >/dev/null \
    || fail "Synthetic rebase conflict lacks REBASE_HEAD."
  if [[ ! -s "$conflict_file" ]]; then
    # Every conflict was delete-shaped; nothing needs a model. Finish the
    # replay here so the run publishes without an AI round at all.
    git rebase --continue >/dev/null \
      || fail "Deterministically resolved rebase could not continue."
    [[ ! -d "$(git rev-parse --git-dir)/rebase-merge" && ! -d "$(git rev-parse --git-dir)/rebase-apply" ]] \
      || fail "Rebase sequencer still active after deterministic resolution."
    emit conflicted false
    emit complete true
    emit head_sha "$(git rev-parse HEAD)"
    emit_paths conflict_paths "$conflict_file"
    return 0
  fi
  emit conflicted true
  emit complete false
  emit head_sha "$(git rev-parse HEAD)"
  emit_paths conflict_paths "$conflict_file"
}

verify() {
  local repo="$1" paths_file actual_file omitted_file count graph_tree base_graph_tree message expected seen path
  write_plan "$repo"
  require_reservation "$repo"
  paths_file="$RUNNER_TEMP/promotion-plan-paths.txt"
  actual_file="$RUNNER_TEMP/promotion-final-paths.txt"
  builtin cd -- "$repo"

  [[ ! -d "$(git rev-parse --git-dir)/rebase-merge" && ! -d "$(git rev-parse --git-dir)/rebase-apply" ]] \
    || fail "Promotion rebase sequencer remains active after resolution."
  [[ -z "$(git ls-files -u)" ]] || fail "Promotion branch still has unmerged index entries."
  git merge-base --is-ancestor "$RESERVATION_SHA" HEAD \
    || fail "Resolved promotion does not descend from its reservation."
  count="$(git rev-list --count "$RESERVATION_SHA..HEAD")"
  [[ "$count" = 1 ]] || fail "Resolved source patch must be exactly one commit above its reservation (found $count)."
  [[ "$(git rev-parse HEAD^1)" == "$RESERVATION_SHA" ]] \
    || fail "Resolved source commit is not a direct child of its reservation."

  git -c core.quotePath=false diff --name-only "$RESERVATION_SHA" HEAD \
    | LC_ALL=C sort -u >"$actual_file"
  [[ -s "$actual_file" ]] || fail "Resolved promotion has no source change above its reservation."
  [[ -z "$(comm -23 "$actual_file" "$paths_file")" ]] \
    || fail "Resolved promotion changes a path outside the exact source plan."
  omitted_file="$RUNNER_TEMP/promotion-omitted-paths.txt"
  comm -23 "$paths_file" "$actual_file" >"$omitted_file"
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    # A planned path can legitimately disappear from the final branch diff
    # only when the exact source-end entry already equals the immutable
    # reservation entry. This includes both entries being absent. Merely
    # resolving a differing incoming path back to the destination side is not
    # an authorized omission.
    git diff --quiet "$RESERVATION_SHA" "$SOURCE_END_SHA" -- ":(literal)$path" \
      || fail "Resolved promotion dropped a differing planned source path: $path"
  done <"$omitted_file"
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    # A standalone ======= is valid Markdown. Every real zdiff3 block carries
    # a start, base, or end marker, so those unambiguous forms fail closed.
    if [[ -f "$path" ]] && LC_ALL=C grep -Iq . "$path" \
      && grep -qE '^(<{7,}|\|{7,}|>{7,})( |$)' -- "$path"; then
      fail "Conflict markers remain in resolved promotion path: $path"
    fi
  done <"$paths_file"

  graph_tree="$(git rev-parse --verify --quiet 'HEAD:graphify-out' || echo missing)"
  base_graph_tree="$(git rev-parse --verify --quiet "$RESERVATION_SHA:graphify-out" || echo missing)"
  [[ "$graph_tree" == "$base_graph_tree" ]] \
    || fail "Graphify output changed before its deterministic derived refresh."

  message="$(git show -s --format=%B HEAD)"
  if [[ "$(<"$RUNNER_TEMP/promotion-review-gated.txt")" == true ]]; then
    grep -Fq '[skip ci]' <<<"$(git show -s --format=%s HEAD)" \
      || fail "Review-gated promotion source commit is missing [skip ci]."
  fi
  for expected in \
    "Thingtime-Promotion-Source-PR: $SOURCE_PR" \
    "Thingtime-Promotion-Base-Ref: $BASE_REF" \
    "Thingtime-Promotion-Base-SHA: $BASE_SHA" \
    "Thingtime-Promotion-Branch: $PROMOTION_BRANCH" \
    "Thingtime-Promotion-Source-Tip-SHA: $SOURCE_TIP_SHA" \
    "Thingtime-Promotion-Source-Start-SHA: $SOURCE_START_SHA" \
    "Thingtime-Promotion-Source-End-SHA: $SOURCE_END_SHA" \
    "Thingtime-Promotion-Source-Lineage: $SOURCE_LINEAGE_STATUS" \
    "Thingtime-Promotion-Plan-Hash: $PLAN_HASH" \
    "Thingtime-Promotion-Patch-ID: $(<"$RUNNER_TEMP/promotion-patch-id.txt")"; do
    seen="$(grep -Fxc -- "$expected" <<<"$message" || true)"
    [[ "$seen" = 1 ]] || fail "Resolved source commit provenance is missing or duplicates: $expected"
  done
  [[ -z "$(git status --porcelain --untracked-files=all)" ]] \
    || fail "Isolated promotion checkout is not clean after verification."
  emit verified true
  emit source_commit_sha "$(git rev-parse HEAD)"
  emit_paths plan_paths "$paths_file"
}

[[ $# -eq 2 ]] || {
  echo "usage: $0 <prepare|verify> <isolated-repo-path>" >&2
  exit 64
}
require_environment
secure_git_environment
repo_abs="$(builtin cd -- "$2" && pwd -P)"
runner_temp_abs="$(builtin cd -- "$RUNNER_TEMP" && pwd -P)"
case "$repo_abs/" in
  "$runner_temp_abs/"*) ;;
  *) fail "Promotion checkout must live under RUNNER_TEMP." ;;
esac

case "$1" in
  prepare) prepare "$repo_abs" ;;
  verify) verify "$repo_abs" ;;
  *) echo "unknown mode: $1" >&2; exit 64 ;;
esac
