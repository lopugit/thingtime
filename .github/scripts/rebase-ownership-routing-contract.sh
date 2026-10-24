#!/usr/bin/env bash

# No-network predicate examples for the rebase-stack ownership router.
# This runs only in the non-blocking contract-advisory lane.

set -euo pipefail

REBASE_OWNER_JQ='($no_ai_rebase != true)
and (
  ($stack_member == true
    and ($mergeable == false or $rebaseable == false))
  or
  ($manual == true
    and $stack_member != true
    and $mergeable == true
    and $rebaseable == false)
)'

STACK_MEMBER_JQ='(any(.[];
  .number == $number
  and .head.repo.full_name == $repo
  and .base.repo.full_name == $repo
  and ([.labels[].name] | index("no-ai-rebase") == null)))
and any(.[];
  .number != $number
  and .head.repo.full_name == $repo
  and .base.repo.full_name == $repo
  and ([.labels[].name] | index("no-ai-rebase") == null)
  and ((.head.ref == $base and $base != $default_ref)
       or (.base.ref == $head and $head != $default_ref)))'

assert_owner() {
  local expected="$1" stack_member="$2" no_ai_rebase="$3"
  local mergeable="$4" rebaseable="$5" manual="$6" label="$7"
  local actual
  actual="$(jq -nr \
    --argjson stack_member "$stack_member" \
    --argjson no_ai_rebase "$no_ai_rebase" \
    --argjson mergeable "$mergeable" \
    --argjson rebaseable "$rebaseable" \
    --argjson manual "$manual" \
    "$REBASE_OWNER_JQ")"
  [ "$actual" = "$expected" ] || {
    printf 'Rebase ownership example failed for %s: expected %s, got %s.\n' \
      "$label" "$expected" "$actual" >&2
    return 1
  }
}

assert_owner false false false true false false "automatic standalone replay conflict"
assert_owner false false false false true false "automatic standalone merge conflict"
assert_owner true true false true false false "stack replay conflict"
assert_owner true true false false true false "stack merge conflict"
assert_owner false true false true true false "clean stack"
assert_owner false true true false false false "no-ai-rebase stack"
assert_owner true false false true false true "manual standalone replay retry"
assert_owner false false false false false true "manual standalone merge conflict"

fixture='[
  {"number":188,"head":{"ref":"develop","repo":{"full_name":"lopugit/thingtime"}},"base":{"ref":"main","repo":{"full_name":"lopugit/thingtime"}},"labels":[{"name":"no-ai-rebase"}]},
  {"number":358,"head":{"ref":"main","repo":{"full_name":"lopugit/thingtime"}},"base":{"ref":"develop","repo":{"full_name":"lopugit/thingtime"}},"labels":[]},
  {"number":359,"head":{"ref":"feature/default-base","repo":{"full_name":"lopugit/thingtime"}},"base":{"ref":"main","repo":{"full_name":"lopugit/thingtime"}},"labels":[]},
  {"number":200,"head":{"ref":"feature/standalone","repo":{"full_name":"lopugit/thingtime"}},"base":{"ref":"develop","repo":{"full_name":"lopugit/thingtime"}},"labels":[]},
  {"number":201,"head":{"ref":"feature/root","repo":{"full_name":"lopugit/thingtime"}},"base":{"ref":"develop","repo":{"full_name":"lopugit/thingtime"}},"labels":[]},
  {"number":202,"head":{"ref":"feature/child","repo":{"full_name":"lopugit/thingtime"}},"base":{"ref":"feature/root","repo":{"full_name":"lopugit/thingtime"}},"labels":[]}
]'

assert_stack() {
  local expected="$1" number="$2" label="$3" pr actual
  pr="$(jq -c --argjson number "$number" '.[] | select(.number == $number)' <<<"$fixture")"
  actual="$(jq -r \
    --arg repo "lopugit/thingtime" \
    --argjson number "$number" \
    --arg head "$(jq -r '.head.ref' <<<"$pr")" \
    --arg base "$(jq -r '.base.ref' <<<"$pr")" \
    --arg default_ref "main" \
    "$STACK_MEMBER_JQ" <<<"$fixture")"
  [ "$actual" = "$expected" ] || {
    printf 'Stack membership example failed for %s: expected %s, got %s.\n' \
      "$label" "$expected" "$actual" >&2
    return 1
  }
}

assert_stack false 188 "no-ai-rebase promotion"
assert_stack false 359 "ordinary PR based on the default branch beside reverse sync"
assert_stack false 200 "standalone beside opted-out promotion"
assert_stack true 201 "stack root"
assert_stack true 202 "stack child"

echo "rebase ownership routing contract: self-test OK"
