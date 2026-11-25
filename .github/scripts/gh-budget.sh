# shellcheck shell=bash
# Shared GitHub API budget deferral for controller steps. Source it right
# after `set -euo pipefail`, route EVERY `gh` call through gh_budgeted, and
# install the deferral as the step's EXIT trap:
#
#   . .github/scripts/gh-budget.sh
#   trap 'gh_budget_defer "<what>" [output=value ...]' EXIT
#
# Exhausting the one shared installation API budget is repository wide and
# self-heals at its published reset. Detector events start from unrelated PRs
# (pull_request_target, pushes, check runs), so letting `set -e` propagate that
# refusal publishes a red check on a PR that neither caused nor can fix it
# (25 Nov 2026: the resolver handoff in run 45549727540 and the stack-rebase
# scan in run 45549774118 both reddened #1545).
#
# gh_budgeted records whether the MOST RECENT call was refused for that budget:
# HTTP 403 or 429 together with "API rate limit exceeded", the same pairing the
# scan steps' gh_read_retry uses. A bare 403 is a real permission failure and is
# never recorded, and any later answer -- success or another failure -- clears
# the record, so a tolerated budget refusal cannot mask a genuine failure that
# follows it. Nothing here retries: the reset can be most of an hour away, and
# a refused mutation (a dispatch POST) is never replayed, so a deferred handoff
# cannot dispatch twice. The record is a file because many calls run inside
# command substitutions and pipelines (subshells).
#
# gh_budget_defer turns a failing exit into a green notice only while that
# record stands, appending each `output=value` argument to GITHUB_OUTPUT. Pass
# the step's existing "nothing to do" answer there: duplicate GITHUB_OUTPUT
# keys resolve to the last value, so it can only decline work, never invent it.

LOPU_GH_BUDGET_SENTINEL="$RUNNER_TEMP/lopu-gh-budget-exhausted"
rm -f "$LOPU_GH_BUDGET_SENTINEL"

gh_budgeted() {
  local errors status=0
  errors="$(mktemp "$RUNNER_TEMP/lopu-gh-budgeted.XXXXXX")"
  gh "$@" 2>"$errors" || status=$?
  if [ "$status" -ne 0 ] \
     && grep -Eq 'HTTP (403|429)([^0-9]|$)' "$errors" \
     && grep -Fq 'API rate limit exceeded' "$errors"; then
    : >"$LOPU_GH_BUDGET_SENTINEL"
  else
    rm -f "$LOPU_GH_BUDGET_SENTINEL"
  fi
  cat "$errors" >&2
  rm -f "$errors"
  return "$status"
}

gh_budget_defer() {
  local code=$? what="$1" output
  shift
  [ "$code" -ne 0 ] || return 0
  [ -e "$LOPU_GH_BUDGET_SENTINEL" ] || return 0
  echo "::notice::Deferring this $what: GitHub's shared installation API budget is exhausted. That is an upstream budget reset, not a defect in any PR. The refused request is not replayed; a later detector re-derives the remaining work."
  for output in "$@"; do
    printf '%s\n' "$output" >>"$GITHUB_OUTPUT"
  done
  exit 0
}
