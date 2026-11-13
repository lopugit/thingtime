#!/usr/bin/env bash

# No-network integration contract for the synthetic promotion worker.

set -euo pipefail
IFS=$'\n\t'

root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
source_subject_sentinel='PROMOTION-QUARANTINE-SOURCE-SENTINEL'
run_temp="$root/run"
repo="$run_temp/repo"
mkdir -p "$repo" "$run_temp"
git -C "$repo" init -q
git -C "$repo" config user.name fixture
git -C "$repo" config user.email fixture@example.invalid

printf 'root\n' >"$repo/feature.txt"
mkdir -p "$repo/remix"
printf 'root changelog\n' >"$repo/remix/CHANGELOG.md"
printf 'feature.txt conflict-marker-size=10\n' >"$repo/.gitattributes"
git -C "$repo" add feature.txt remix/CHANGELOG.md .gitattributes
git -C "$repo" commit -qm root
source_start="$(git -C "$repo" rev-parse HEAD)"

git -C "$repo" switch -qc source
mkdir -p "$repo/.github/workflows"
printf 'source intent\n' >"$repo/feature.txt"
printf 'new source file\n' >"$repo/new.txt"
printf 'literal pathspec file\n' >"$repo/:(glob)feature.txt"
printf 'unicode path\n' >"$repo/é.txt"
printf 'name: fixture\n' >"$repo/.github/workflows/fixture.yml"
printf 'source changelog entry\n' >"$repo/remix/CHANGELOG.md"
git -C "$repo" add -- ':(literal)feature.txt' ':(literal)new.txt' \
  ':(literal):(glob)feature.txt' ':(literal)é.txt' \
  ':(literal).github/workflows/fixture.yml' ':(literal)remix/CHANGELOG.md'
git -C "$repo" commit -qm "$source_subject_sentinel"
source_end="$(git -C "$repo" rev-parse HEAD)"
# The aggregate changelog evolves after the feature endpoint. Source-lineage
# verification must use the feature paths, not let this normal aggregate drift
# falsely downgrade an otherwise present patch.
printf 'later aggregate changelog\n' >"$repo/remix/CHANGELOG.md"
git -C "$repo" commit -qam 'later changelog aggregation'
source_tip="$(git -C "$repo" rev-parse HEAD)"

git -C "$repo" switch -qC main "$source_start"
printf 'base only\n' >"$repo/base.txt"
printf 'base intent\n' >"$repo/feature.txt"
# This source-planned addition already exists identically on the destination;
# the rebased result may legitimately omit it from the final branch diff.
printf 'new source file\n' >"$repo/new.txt"
git -C "$repo" add -- ':(literal)base.txt' ':(literal)feature.txt' ':(literal)new.txt'
git -C "$repo" commit -qm base
base_sha="$(git -C "$repo" rev-parse HEAD)"

source_pr=42
base_ref=main
branch=promote/pr-42-fixture
paths_json='[".github/workflows/fixture.yml",":(glob)feature.txt","feature.txt","new.txt","remix/CHANGELOG.md","é.txt"]'
patch_file="$root/fixture.patch"
git -C "$repo" diff --binary --full-index "$source_start" "$source_end" -- \
  ':(literal).github/workflows/fixture.yml' ':(literal):(glob)feature.txt' \
  ':(literal)feature.txt' ':(literal)new.txt' \
  ':(literal)remix/CHANGELOG.md' ':(literal)é.txt' >"$patch_file"
patch_id="$(git -C "$repo" patch-id --stable <"$patch_file" | awk 'NR == 1 { print $1 }')"
compute_plan_hash() {
  local lineage_status="$1"
  SOURCE_PR="$source_pr" BASE_REF="$base_ref" BASE_SHA="$base_sha" BRANCH="$branch" \
  SOURCE_START="$source_start" SOURCE_END="$source_end" SOURCE_LINEAGE_STATUS="$lineage_status" \
  PATHS_JSON="$paths_json" PATCH_ID="$patch_id" \
  node <<'NODE'
const crypto = require('node:crypto');
const value = {
  v: 1,
  source_pr: Number(process.env.SOURCE_PR),
  base_ref: process.env.BASE_REF,
  base_sha: process.env.BASE_SHA,
  branch: process.env.BRANCH,
  source_start_sha: process.env.SOURCE_START,
  source_end_sha: process.env.SOURCE_END,
  source_lineage_status: process.env.SOURCE_LINEAGE_STATUS,
  paths: JSON.parse(process.env.PATHS_JSON),
  patch_id: process.env.PATCH_ID,
};
process.stdout.write(crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'));
NODE
}
source_lineage_status=verified
plan_hash="$(compute_plan_hash "$source_lineage_status")"

git -C "$repo" commit -q --allow-empty \
  -m 'Reserve promotion fixture' \
  -m 'Thingtime-Promotion-Reservation: v1' \
  -m "Thingtime-Promotion-Source-PR: $source_pr" \
  -m "Thingtime-Promotion-Base-Ref: $base_ref" \
  -m "Thingtime-Promotion-Base-SHA: $base_sha" \
  -m "Thingtime-Promotion-Branch: $branch" \
  -m "Thingtime-Promotion-Source-Start-SHA: $source_start" \
  -m "Thingtime-Promotion-Source-End-SHA: $source_end" \
  -m "Thingtime-Promotion-Source-Lineage: $source_lineage_status" \
  -m "Thingtime-Promotion-Plan-Hash: $plan_hash"
reservation_sha="$(git -C "$repo" rev-parse HEAD)"

export RUNNER_TEMP="$run_temp"
export GITHUB_OUTPUT="$root/output"
export SOURCE_PR="$source_pr"
export BASE_REF="$base_ref"
export BASE_SHA="$base_sha"
export PROMOTION_BRANCH="$branch"
export RESERVATION_SHA="$reservation_sha"
export SOURCE_START_SHA="$source_start"
export SOURCE_TIP_SHA="$source_tip"
export SOURCE_END_SHA="$source_end"
export SOURCE_LINEAGE_STATUS="$source_lineage_status"
export PLAN_HASH="$plan_hash"
export RUN_URL='https://example.invalid/actions/runs/1'

worker="$(cd "$(dirname "$0")" && pwd -P)/rebase-stack/promotion-worker.sh"
authority="$(cd "$(dirname "$0")" && pwd -P)/rebase-stack/verify-promotion-source-authority.sh"
prepare_round="$(cd "$(dirname "$0")" && pwd -P)/rebase-stack/prepare-round.sh"
refresh_graphify="$(cd "$(dirname "$0")" && pwd -P)/rebase-stack/refresh-promotion-graphify.sh"
printf '[{}]\n' >"$run_temp/pr-commits.json"
printf '[".github/workflows/fixture.yml",":(glob)feature.txt","feature.txt","new.txt","remix/CHANGELOG.md","é.txt"]\n' \
  >"$run_temp/pr-files.json"
: >"$GITHUB_OUTPUT"
bash "$authority" "$repo" "$run_temp/pr-commits.json" "$run_temp/pr-files.json"
grep -qx 'source_authority=verified' "$GITHUB_OUTPUT"
SOURCE_START_SHA="$base_sha" \
  bash "$authority" "$repo" "$run_temp/pr-commits.json" "$run_temp/pr-files.json" >/dev/null 2>&1 \
  && { echo 'tampered source-start unexpectedly passed authority verification' >&2; exit 1; }

# A real GitHub merge endpoint authorizes only its first-parent aggregate
# patch. The feature-side parent must never be accepted as caller-supplied
# source-start authority.
merge_repo="$run_temp/merge-authority-repo"
mkdir -p "$merge_repo"
git -C "$merge_repo" init -q
git -C "$merge_repo" config user.name fixture
git -C "$merge_repo" config user.email fixture@example.invalid
printf 'root\n' >"$merge_repo/root.txt"
git -C "$merge_repo" add root.txt
git -C "$merge_repo" commit -qm root
merge_root_branch="$(git -C "$merge_repo" branch --show-current)"
git -C "$merge_repo" switch -qc feature
printf 'feature\n' >"$merge_repo/merge-feature.txt"
git -C "$merge_repo" add merge-feature.txt
git -C "$merge_repo" commit -qm feature
merge_feature_parent="$(git -C "$merge_repo" rev-parse HEAD)"
git -C "$merge_repo" switch -q "$merge_root_branch"
printf 'develop\n' >"$merge_repo/develop.txt"
git -C "$merge_repo" add develop.txt
git -C "$merge_repo" commit -qm develop
merge_first_parent="$(git -C "$merge_repo" rev-parse HEAD)"
git -C "$merge_repo" merge -q --no-ff feature -m 'merge feature'
merge_endpoint="$(git -C "$merge_repo" rev-parse HEAD)"
# True merge endpoints do not need live PR commit/file metadata: their
# independently reproducible patch boundary is always the first parent.
printf '[]\n' >"$run_temp/pr-commits.json"
printf '[]\n' >"$run_temp/pr-files.json"
: >"$GITHUB_OUTPUT"
SOURCE_START_SHA="$merge_first_parent" SOURCE_END_SHA="$merge_endpoint" \
  bash "$authority" "$merge_repo" "$run_temp/pr-commits.json" "$run_temp/pr-files.json"
grep -qx 'source_authority=verified' "$GITHUB_OUTPUT"
SOURCE_START_SHA="$merge_feature_parent" SOURCE_END_SHA="$merge_endpoint" \
  bash "$authority" "$merge_repo" "$run_temp/pr-commits.json" "$run_temp/pr-files.json" >/dev/null 2>&1 \
  && { echo 'merge feature-side parent unexpectedly passed source authority' >&2; exit 1; }

# NEVER CANCEL (owner decision, 2026-08-12): a review-required classification
# REPLAYS for review instead of refusing — the worker review-gates it and the
# published PR carries `source-lineage-unverified`. These fixtures prove the
# replay proceeds AND stays review-gated. What must still never replay is a
# plan whose declared classification differs from the worker's independent
# re-derivation (forged or stale); that boundary keeps its own fixture below.
require_review_replay() {
  local planned="$1" observed="$2" tip="$3"
  local fixture_repo="$run_temp/lineage-$planned-$observed" fixture_hash fixture_reservation
  local fixture_output fixture_log
  git clone -q --no-local "$repo" "$fixture_repo"
  git -C "$fixture_repo" config user.name fixture
  git -C "$fixture_repo" config user.email fixture@example.invalid
  if [[ "$observed" == ambiguous ]]; then
    git -C "$fixture_repo" switch -q --detach "$source_end"
    printf 'later overlapping source evolution\n' >"$fixture_repo/feature.txt"
    git -C "$fixture_repo" add -- ':(literal)feature.txt'
    git -C "$fixture_repo" commit -qm 'overlap source patch'
    tip="$(git -C "$fixture_repo" rev-parse HEAD)"
  fi
  fixture_hash="$(compute_plan_hash "$planned")"
  git -C "$fixture_repo" switch -q --detach "$base_sha"
  git -C "$fixture_repo" commit -q --allow-empty \
    -m 'Reserve promotion lineage fixture' \
    -m 'Thingtime-Promotion-Reservation: v1' \
    -m "Thingtime-Promotion-Source-PR: $source_pr" \
    -m "Thingtime-Promotion-Base-Ref: $base_ref" \
    -m "Thingtime-Promotion-Base-SHA: $base_sha" \
    -m "Thingtime-Promotion-Branch: $branch" \
    -m "Thingtime-Promotion-Source-Start-SHA: $source_start" \
    -m "Thingtime-Promotion-Source-End-SHA: $source_end" \
    -m "Thingtime-Promotion-Source-Lineage: $planned" \
    -m "Thingtime-Promotion-Plan-Hash: $fixture_hash"
  fixture_reservation="$(git -C "$fixture_repo" rev-parse HEAD)"
  fixture_output="$root/lineage-$planned-$observed-output"
  fixture_log="$root/lineage-$planned-$observed-log"
  : >"$fixture_output"
  if ! GITHUB_OUTPUT="$fixture_output" \
  RESERVATION_SHA="$fixture_reservation" SOURCE_TIP_SHA="$tip" \
  SOURCE_LINEAGE_STATUS="$planned" PLAN_HASH="$fixture_hash" \
    bash "$worker" prepare "$fixture_repo" >"$fixture_log" 2>&1; then
    echo "review-required lineage fixture refused to replay ($planned / $observed)" >&2
    cat "$fixture_log" >&2
    exit 1
  fi
  # Same content conflict as the verified happy path — the model round still
  # gets it — but the run is review-gated by lineage alone.
  grep -qx 'conflicted=true' "$fixture_output"
  grep -qx 'complete=false' "$fixture_output"
  grep -qx 'review_gated=true' "$fixture_output"
  grep -qx "source_lineage_status=$planned" "$fixture_output"
}

reject_lineage_mismatch() {
  local planned="$1" observed="$2" tip="$3"
  local fixture_repo="$run_temp/lineage-$planned-$observed" fixture_hash fixture_reservation
  local before_head before_refs after_refs fixture_output fixture_log
  git clone -q --no-local "$repo" "$fixture_repo"
  git -C "$fixture_repo" config user.name fixture
  git -C "$fixture_repo" config user.email fixture@example.invalid
  if [[ "$observed" == ambiguous ]]; then
    git -C "$fixture_repo" switch -q --detach "$source_end"
    printf 'later overlapping source evolution\n' >"$fixture_repo/feature.txt"
    git -C "$fixture_repo" add -- ':(literal)feature.txt'
    git -C "$fixture_repo" commit -qm 'overlap source patch'
    tip="$(git -C "$fixture_repo" rev-parse HEAD)"
  fi
  fixture_hash="$(compute_plan_hash "$planned")"
  git -C "$fixture_repo" switch -q --detach "$base_sha"
  git -C "$fixture_repo" commit -q --allow-empty \
    -m 'Reserve promotion lineage fixture' \
    -m 'Thingtime-Promotion-Reservation: v1' \
    -m "Thingtime-Promotion-Source-PR: $source_pr" \
    -m "Thingtime-Promotion-Base-Ref: $base_ref" \
    -m "Thingtime-Promotion-Base-SHA: $base_sha" \
    -m "Thingtime-Promotion-Branch: $branch" \
    -m "Thingtime-Promotion-Source-Start-SHA: $source_start" \
    -m "Thingtime-Promotion-Source-End-SHA: $source_end" \
    -m "Thingtime-Promotion-Source-Lineage: $planned" \
    -m "Thingtime-Promotion-Plan-Hash: $fixture_hash"
  fixture_reservation="$(git -C "$fixture_repo" rev-parse HEAD)"
  before_head="$(git -C "$fixture_repo" rev-parse HEAD)"
  before_refs="$(git -C "$fixture_repo" show-ref)"
  fixture_output="$root/lineage-$planned-$observed-output"
  fixture_log="$root/lineage-$planned-$observed-log"
  : >"$fixture_output"
  if GITHUB_OUTPUT="$fixture_output" \
  RESERVATION_SHA="$fixture_reservation" SOURCE_TIP_SHA="$tip" \
  SOURCE_LINEAGE_STATUS="$planned" PLAN_HASH="$fixture_hash" \
    bash "$worker" prepare "$fixture_repo" >"$fixture_log" 2>&1; then
    echo "unsafe lineage fixture unexpectedly replayed ($planned / $observed)" >&2
    exit 1
  fi
  grep -Fq 'Source-lineage classification differs from the trusted handoff' "$fixture_log"
  grep -Fq "review-required-$observed" "$fixture_log"
  [[ "$(git -C "$fixture_repo" rev-parse HEAD)" == "$before_head" ]]
  after_refs="$(git -C "$fixture_repo" show-ref)"
  [[ "$after_refs" == "$before_refs" ]]
  [[ -z "$(git -C "$fixture_repo" status --porcelain --untracked-files=all)" ]]
  [[ ! -d "$(git -C "$fixture_repo" rev-parse --git-dir)/rebase-merge" ]]
  [[ ! -d "$(git -C "$fixture_repo" rev-parse --git-dir)/rebase-apply" ]]
  [[ ! -s "$fixture_output" ]]
}
require_review_replay review-required-removed removed "$source_start"
require_review_replay review-required-ambiguous ambiguous ""
reject_lineage_mismatch verified ambiguous ""

if SOURCE_LINEAGE_STATUS=review-required-removed \
  bash "$worker" prepare "$repo" >/dev/null 2>&1; then
  echo 'verified source tip unexpectedly accepted a removed lineage classification' >&2
  exit 1
fi
if SOURCE_LINEAGE_STATUS=untrusted-lineage \
  bash "$worker" prepare "$repo" >/dev/null 2>&1; then
  echo 'unknown source lineage classification unexpectedly passed validation' >&2
  exit 1
fi
if env -u SOURCE_LINEAGE_STATUS bash "$worker" prepare "$repo" >/dev/null 2>&1; then
  echo 'missing source lineage classification unexpectedly passed validation' >&2
  exit 1
fi

# Delete-shaped conflicts (#211's shape): the source patch deletes a file the
# base modified, and still changes a file the base deleted. Neither side has
# merged text, so the model can never be shown them — the worker must settle
# both toward the source patch's intent and finish the replay itself, with no
# AI round at all.
delete_temp="$run_temp/delete-shape"
delete_repo="$delete_temp/repo"
mkdir -p "$delete_repo"
git -C "$delete_repo" init -q
git -C "$delete_repo" config user.name fixture
git -C "$delete_repo" config user.email fixture@example.invalid
printf 'doomed v0\n' >"$delete_repo/doomed.txt"
printf 'kept v0\n' >"$delete_repo/kept.txt"
printf 'super v0\n' >"$delete_repo/super.txt"
git -C "$delete_repo" add doomed.txt kept.txt super.txt
git -C "$delete_repo" commit -qm root
delete_start="$(git -C "$delete_repo" rev-parse HEAD)"
git -C "$delete_repo" switch -qc source
git -C "$delete_repo" rm -q doomed.txt
printf 'kept by the patch\n' >"$delete_repo/kept.txt"
printf 'super v1\n' >"$delete_repo/super.txt"
git -C "$delete_repo" add kept.txt super.txt
git -C "$delete_repo" commit -qm 'delete doomed, rewrite kept, evolve super'
printf 'super v2 final\n' >"$delete_repo/super.txt"
git -C "$delete_repo" commit -qam 'super evolves past the base state'
delete_end="$(git -C "$delete_repo" rev-parse HEAD)"
git -C "$delete_repo" switch -qC delete-main "$delete_start"
printf 'doomed but modified on base\n' >"$delete_repo/doomed.txt"
git -C "$delete_repo" rm -q kept.txt
printf 'super v1\n' >"$delete_repo/super.txt"
git -C "$delete_repo" add doomed.txt super.txt
git -C "$delete_repo" commit -qm 'base moves the other way'
delete_base="$(git -C "$delete_repo" rev-parse HEAD)"
delete_paths_json='["doomed.txt","kept.txt","super.txt"]'
delete_patch="$root/delete-shape.patch"
git -C "$delete_repo" diff --binary --full-index "$delete_start" "$delete_end" -- \
  ':(literal)doomed.txt' ':(literal)kept.txt' ':(literal)super.txt' >"$delete_patch"
delete_patch_id="$(git -C "$delete_repo" patch-id --stable <"$delete_patch" | awk 'NR == 1 { print $1 }')"
delete_plan_hash="$(
  SOURCE_PR="$source_pr" BASE_REF=delete-main BASE_SHA="$delete_base" BRANCH="$branch" \
  SOURCE_START="$delete_start" SOURCE_END="$delete_end" SOURCE_LINEAGE_STATUS=verified \
  PATHS_JSON="$delete_paths_json" PATCH_ID="$delete_patch_id" \
  node <<'NODE'
const crypto = require('node:crypto');
const value = {
  v: 1,
  source_pr: Number(process.env.SOURCE_PR),
  base_ref: process.env.BASE_REF,
  base_sha: process.env.BASE_SHA,
  branch: process.env.BRANCH,
  source_start_sha: process.env.SOURCE_START,
  source_end_sha: process.env.SOURCE_END,
  source_lineage_status: process.env.SOURCE_LINEAGE_STATUS,
  paths: JSON.parse(process.env.PATHS_JSON),
  patch_id: process.env.PATCH_ID,
};
process.stdout.write(crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'));
NODE
)"
git -C "$delete_repo" switch -q --detach "$delete_base"
git -C "$delete_repo" commit -q --allow-empty \
  -m 'Reserve promotion delete fixture' \
  -m 'Thingtime-Promotion-Reservation: v1' \
  -m "Thingtime-Promotion-Source-PR: $source_pr" \
  -m 'Thingtime-Promotion-Base-Ref: delete-main' \
  -m "Thingtime-Promotion-Base-SHA: $delete_base" \
  -m "Thingtime-Promotion-Branch: $branch" \
  -m "Thingtime-Promotion-Source-Start-SHA: $delete_start" \
  -m "Thingtime-Promotion-Source-End-SHA: $delete_end" \
  -m 'Thingtime-Promotion-Source-Lineage: verified' \
  -m "Thingtime-Promotion-Plan-Hash: $delete_plan_hash"
delete_reservation="$(git -C "$delete_repo" rev-parse HEAD)"
delete_output="$root/delete-shape-output"
: >"$delete_output"
GITHUB_OUTPUT="$delete_output" RUNNER_TEMP="$delete_temp" \
BASE_REF=delete-main BASE_SHA="$delete_base" RESERVATION_SHA="$delete_reservation" \
SOURCE_START_SHA="$delete_start" SOURCE_END_SHA="$delete_end" SOURCE_TIP_SHA="$delete_end" \
SOURCE_LINEAGE_STATUS=verified PLAN_HASH="$delete_plan_hash" \
  bash "$worker" prepare "$delete_repo"
grep -qx 'conflicted=false' "$delete_output"
grep -qx 'complete=true' "$delete_output"
grep -qx 'review_gated=false' "$delete_output"
[[ "$(git -C "$delete_repo" rev-parse HEAD^1)" == "$delete_reservation" ]]
git -C "$delete_repo" diff --name-status "$delete_reservation" HEAD | LC_ALL=C sort >"$root/delete-shape-diff"
printf 'A\tkept.txt\nD\tdoomed.txt\nM\tsuper.txt\n' | diff -u - "$root/delete-shape-diff"
[[ "$(git -C "$delete_repo" show HEAD:kept.txt)" == 'kept by the patch' ]]
# The superseded content conflict settled to the patch side without a model.
[[ "$(git -C "$delete_repo" show HEAD:super.txt)" == 'super v2 final' ]]
git -C "$delete_repo" show -s --format=%s HEAD \
  | grep -qx "Promote source PR #$source_pr onto delete-main"
[[ ! -d "$(git -C "$delete_repo" rev-parse --git-dir)/rebase-merge" ]]
[[ ! -d "$(git -C "$delete_repo" rev-parse --git-dir)/rebase-apply" ]]
[[ -z "$(git -C "$delete_repo" status --porcelain --untracked-files=all)" ]]
# The review comment's evidence: each deterministic resolution names the
# base-side commits the source patch never saw.
grep -qF -- '- `doomed.txt` — deleted by the source patch' "$delete_temp/promotion-discarded-changes.md"
grep -qF -- '- `kept.txt` — the base deleted this file' "$delete_temp/promotion-discarded-changes.md"
grep -qF 'base moves the other way' "$delete_temp/promotion-discarded-changes.md"
grep -qF 'already contained in the source history' "$delete_temp/promotion-discarded-changes.md"

: >"$GITHUB_OUTPUT"
bash "$worker" prepare "$repo"
grep -qx 'conflicted=true' "$GITHUB_OUTPUT"
grep -qx 'complete=false' "$GITHUB_OUTPUT"
grep -qx 'ci_sensitive_paths=true' "$GITHUB_OUTPUT"
grep -qx 'review_gated=true' "$GITHUB_OUTPUT"
grep -qx 'workflow_paths=true' "$GITHUB_OUTPUT"
grep -qx 'source_lineage_status=verified' "$GITHUB_OUTPUT"
grep -qxF '.github/workflows/fixture.yml' "$GITHUB_OUTPUT"
grep -qx ':(glob)feature.txt' "$GITHUB_OUTPUT"
grep -qx 'feature.txt' "$GITHUB_OUTPUT"
grep -qx 'é.txt' "$GITHUB_OUTPUT"
grep -qx "plan_hash=$plan_hash" "$GITHUB_OUTPUT"

# The repository deliberately raises conflict-marker-size to 10. Git must have
# produced that real marker shape, and the shared pre-model parser must accept
# the coherent block instead of incorrectly classifying it as malformed.
grep -q '^<<<<<<<<<< ' "$repo/feature.txt"
marker_workspace="$run_temp/marker-workspace"
marker_round="$run_temp/marker-round"
marker_output="$run_temp/marker-output"
mkdir -p "$marker_workspace" "$marker_round"
: >"$marker_output"
AI_REBASE_CONFLICT_POLICY=promotion \
GITHUB_WORKSPACE="$marker_workspace" \
GITHUB_OUTPUT="$marker_output" \
RUNNER_TEMP="$run_temp" \
  bash "$prepare_round" "$repo" "$marker_workspace" "$marker_round"
grep -qx 'needs_ai=true' "$marker_output"
grep -q '^<<<<<<<<<< ' "$marker_workspace/feature.txt"

# Resolve the creation-time conflict deterministically, mirroring the import
# performed after the isolated model has returned exact file bytes.
printf 'base intent\nsource intent\n' >"$repo/feature.txt"
git -C "$repo" add -- ':(literal)feature.txt'
GIT_EDITOR=true git -C "$repo" rebase --continue >/dev/null
git -C "$repo" show -s --format=%s HEAD | grep -q '\[skip ci\]'
if git -C "$repo" log --format=%s "$base_sha..HEAD" \
  | grep -Fqx "$source_subject_sentinel"; then
  echo 'original source commit subject escaped the trusted synthetic replay' >&2
  exit 1
fi

: >"$GITHUB_OUTPUT"
bash "$worker" verify "$repo"
grep -qx 'verified=true' "$GITHUB_OUTPUT"
good_head="$(git -C "$repo" rev-parse HEAD)"

# A differing incoming path must not be silently resolved back to the exact
# destination entry. Other planned changes keep the branch diff nonempty, so
# this locks the per-path omission proof rather than merely the overall subset.
printf 'base intent\n' >"$repo/feature.txt"
git -C "$repo" add -- ':(literal)feature.txt'
git -C "$repo" commit -q --amend --no-edit
: >"$GITHUB_OUTPUT"
if bash "$worker" verify "$repo" >/dev/null 2>&1; then
  echo 'differing planned path dropped to base unexpectedly passed verification' >&2
  exit 1
fi
git -C "$repo" reset -q --hard "$good_head"

# Even within the single proven source commit, an unplanned path invalidates
# the result. The successful verification above also proves that new.txt may
# disappear only because its exact source-end entry already matches the base.
printf 'rogue\n' >"$repo/rogue.txt"
git -C "$repo" add rogue.txt
git -C "$repo" commit -q --amend --no-edit
: >"$GITHUB_OUTPUT"
if bash "$worker" verify "$repo" >/dev/null 2>&1; then
  echo 'unplanned path unexpectedly passed promotion verification' >&2
  exit 1
fi
git -C "$repo" reset -q --hard "$good_head"

# A standalone Markdown divider is not a conflict marker.
printf '\n=======\n' >>"$repo/feature.txt"
git -C "$repo" add -- ':(literal)feature.txt'
git -C "$repo" commit -q --amend --no-edit
: >"$GITHUB_OUTPUT"
bash "$worker" verify "$repo"
grep -qx 'verified=true' "$GITHUB_OUTPUT"

# A real non-default-size zdiff3 block (including malformed remnants with
# start/base/end markers) must still fail verification.
cat >>"$repo/feature.txt" <<'MARKERS'
<<<<<<<<<< HEAD
destination
|||||||||| parent
ancestor
==========
incoming
>>>>>>>>>> REBASE_HEAD
MARKERS
git -C "$repo" add -- ':(literal)feature.txt'
git -C "$repo" commit -q --amend --no-edit
: >"$GITHUB_OUTPUT"
if bash "$worker" verify "$repo" >/dev/null 2>&1; then
  echo 'marker-bearing promotion unexpectedly passed verification' >&2
  exit 1
fi
git -C "$repo" reset -q --hard "$good_head"

# A later unexplained commit must invalidate the one-to-one reservation proof.
printf 'unexplained\n' >"$repo/tamper.txt"
git -C "$repo" add tamper.txt
git -C "$repo" commit -qm tamper
: >"$GITHUB_OUTPUT"
if bash "$worker" verify "$repo" >/dev/null 2>&1; then
  echo 'tampered promotion unexpectedly passed verification' >&2
  exit 1
fi

# A removed historical patch that honestly declares review-required lineage
# now replays review-gated (never-cancel) — but a FORGED handoff that labels
# the same removed patch `verified` must still hard-block: the worker's
# independent source-tip proof contradicts the declaration before the
# synthetic commit/rebase, so no candidate commit or promotable ref is
# created from a plan that lies about its own classification.
(
  lineage_only_repo="$run_temp/lineage-only-review"
  mkdir -p "$lineage_only_repo"
  git -C "$lineage_only_repo" init -q
  git -C "$lineage_only_repo" config user.name fixture
  git -C "$lineage_only_repo" config user.email fixture@example.invalid
  printf 'feature base\n' >"$lineage_only_repo/feature.txt"
  git -C "$lineage_only_repo" add feature.txt
  git -C "$lineage_only_repo" commit -qm root
  source_start="$(git -C "$lineage_only_repo" rev-parse HEAD)"
  git -C "$lineage_only_repo" switch -qc source
  printf 'feature restored\n' >"$lineage_only_repo/feature.txt"
  git -C "$lineage_only_repo" commit -qam 'UNVERIFIED-NONCI-SOURCE-SENTINEL'
  source_end="$(git -C "$lineage_only_repo" rev-parse HEAD)"
  source_tip="$source_start"
  git -C "$lineage_only_repo" switch -qC main "$source_start"
  printf 'destination base\n' >"$lineage_only_repo/base.txt"
  git -C "$lineage_only_repo" add base.txt
  git -C "$lineage_only_repo" commit -qm destination
  base_sha="$(git -C "$lineage_only_repo" rev-parse HEAD)"
  source_pr=43
  base_ref=main
  branch=promote/pr-43-lineage-only
  paths_json='["feature.txt"]'
  patch_file="$root/lineage-only.patch"
  git -C "$lineage_only_repo" diff --binary --full-index "$source_start" "$source_end" \
    -- ':(literal)feature.txt' >"$patch_file"
  patch_id="$(git -C "$lineage_only_repo" patch-id --stable <"$patch_file" | awk 'NR == 1 { print $1 }')"
  source_lineage_status=verified
  plan_hash="$(compute_plan_hash "$source_lineage_status")"
  git -C "$lineage_only_repo" commit -q --allow-empty \
    -m 'Reserve lineage-only review fixture' \
    -m 'Thingtime-Promotion-Reservation: v1' \
    -m "Thingtime-Promotion-Source-PR: $source_pr" \
    -m "Thingtime-Promotion-Base-Ref: $base_ref" \
    -m "Thingtime-Promotion-Base-SHA: $base_sha" \
    -m "Thingtime-Promotion-Branch: $branch" \
    -m "Thingtime-Promotion-Source-Start-SHA: $source_start" \
    -m "Thingtime-Promotion-Source-End-SHA: $source_end" \
    -m "Thingtime-Promotion-Source-Lineage: $source_lineage_status" \
    -m "Thingtime-Promotion-Plan-Hash: $plan_hash"
  reservation_sha="$(git -C "$lineage_only_repo" rev-parse HEAD)"
  lineage_output="$root/lineage-only-output"
  lineage_log="$root/lineage-only-log"
  before_head="$(git -C "$lineage_only_repo" rev-parse HEAD)"
  before_refs="$(git -C "$lineage_only_repo" show-ref)"
  : >"$lineage_output"
  if GITHUB_OUTPUT="$lineage_output" \
  SOURCE_PR="$source_pr" BASE_REF="$base_ref" BASE_SHA="$base_sha" \
  PROMOTION_BRANCH="$branch" RESERVATION_SHA="$reservation_sha" \
  SOURCE_START_SHA="$source_start" SOURCE_TIP_SHA="$source_tip" SOURCE_END_SHA="$source_end" \
  SOURCE_LINEAGE_STATUS="$source_lineage_status" PLAN_HASH="$plan_hash" \
    bash "$worker" prepare "$lineage_only_repo" >"$lineage_log" 2>&1; then
    echo 'removed non-CI source patch unexpectedly entered synthetic replay' >&2
    exit 1
  fi
  grep -Fq 'Source-lineage classification differs from the trusted handoff' "$lineage_log"
  grep -Fq 'review-required-removed' "$lineage_log"
  [[ "$(git -C "$lineage_only_repo" rev-parse HEAD)" == "$before_head" ]]
  [[ "$(git -C "$lineage_only_repo" show-ref)" == "$before_refs" ]]
  [[ -z "$(git -C "$lineage_only_repo" status --porcelain --untracked-files=all)" ]]
  [[ ! -d "$(git -C "$lineage_only_repo" rev-parse --git-dir)/rebase-merge" ]]
  [[ ! -d "$(git -C "$lineage_only_repo" rev-parse --git-dir)/rebase-apply" ]]
  [[ ! -s "$lineage_output" ]]
)

# Owner decision (2026-08-12): no sensitive-path deny-list. A credential-named
# workflow conflict — the exact shape the old policy refused — must now be
# ELIGIBLE for the model round like any other coherent content conflict.
policy_repo="$run_temp/policy-repo"
policy_workspace="$run_temp/policy-workspace"
policy_round="$run_temp/policy-round"
mkdir -p "$policy_repo" "$policy_workspace" "$policy_round"
git -C "$policy_repo" init -q
git -C "$policy_repo" config user.name fixture
git -C "$policy_repo" config user.email fixture@example.invalid
mkdir -p "$policy_repo/.github/workflows"
printf 'root\n' >"$policy_repo/.github/workflows/token-rotation.yml"
git -C "$policy_repo" add -- ':(literal).github/workflows/token-rotation.yml'
git -C "$policy_repo" commit -qm root
policy_root="$(git -C "$policy_repo" rev-parse HEAD)"
git -C "$policy_repo" switch -qc source
printf 'source\n' >"$policy_repo/.github/workflows/token-rotation.yml"
git -C "$policy_repo" commit -qam source
policy_source="$(git -C "$policy_repo" rev-parse HEAD)"
git -C "$policy_repo" switch -qC main "$policy_root"
printf 'base\n' >"$policy_repo/.github/workflows/token-rotation.yml"
git -C "$policy_repo" commit -qam base
git -C "$policy_repo" config merge.conflictStyle zdiff3
if git -C "$policy_repo" rebase --onto HEAD "$policy_root" "$policy_source" >/dev/null 2>&1; then
  echo 'terminal policy fixture unexpectedly rebased cleanly' >&2
  exit 1
fi
: >"$root/policy-output"
AI_REBASE_CONFLICT_POLICY=promotion \
GITHUB_WORKSPACE="$policy_workspace" \
GITHUB_OUTPUT="$root/policy-output" \
RUNNER_TEMP="$run_temp" \
  bash "$prepare_round" "$policy_repo" "$policy_workspace" "$policy_round"
grep -qx 'needs_ai=true' "$root/policy-output"
grep -q '^<<<<<<<' "$policy_workspace/.github/workflows/token-rotation.yml"

bash "$refresh_graphify" --self-test-history-boundary

echo 'promotion worker contract: self-test OK'
