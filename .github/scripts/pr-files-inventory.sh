# shellcheck shell=bash
# Changed-file hydration for the conflict detector's open-PR inventory, with a
# cross-run cache. Source it in the detect scan step (gh_read_retry, REPO and
# RUNNER_TEMP come from that step) and read it under command substitution:
#
#   . .github/scripts/pr-files-inventory.sh
#   all_open="$(complete_large_pr_files "$all_open")"
#
# Keep expensive diff generation out of the shared GraphQL query: one large PR
# can time out every otherwise healthy PR in the page. Hydrate changed paths
# independently after mergeability settles. Failure preserves explicit
# incomplete state and does not abort the repository scan. Diagnostics must
# stay on stderr, never JSON stdout: that stdout IS the inventory.
#
# Per-PR isolation stopped one ungeneratable diff from poisoning the shared
# inventory but left the AGGREGATE cost unbounded, taking the same scan down a
# second way: this loop is O(open PRs) and the slow-diff retry made each
# refusal cost ~26s instead of ~2s. Two bounds keep it out of the detector's
# timeout. LOPU_SLOW_DIFF_RETRY is `local`, so bash's dynamic scope declines
# that retry for this function only while load-bearing readers keep all four
# attempts; FILES_INVENTORY_DEADLINE_SECONDS then caps the loop on the step's
# clock. PRs past it keep the explicit incomplete state a single read failure
# already produces and the next sweep retries them, and the deferral names
# them: an un-hydrated PR is indistinguishable from a PR that changed no files.
#
# Cache (25 Nov 2026). Every PR used to be re-read on every scan: ~143 open
# PRs, ~316 paginated `pulls/N/files` requests, ~18 scans an hour -- over half
# of the GitHub App's 5,000/hr installation budget -- and 26 PRs answered HTTP
# 422 "diff is taking too long to generate" every time. A PR's changed files
# are a function of its head commit and its merge base with the base branch, so
# an entry is reused only on an exact number + headRefOid + baseRefName match
# and only while it is younger than LOPU_PR_FILES_TTL (one day). The TTL bounds
# the one case the key cannot see: a rewritten (force-pushed) base branch can
# move the merge base under an unchanged head. A 422 at a head is cached too,
# so it costs one probe per LOPU_PR_FILES_TOO_LARGE_TTL (6h) instead of one per
# scan; a cached 422 keeps the PR explicitly incomplete and is named in a
# warning. Anything else -- no entry, another head or base, an expired entry --
# is today's read, under the same deadline.
#
# The file travels between runs through actions/cache (restore before the scan,
# save after it), which is scoped by branch: a run restores the newest entry of
# its own ref scope, else the default branch's, and saves into its own ref.
# Entries are immutable, so every save uses a run-unique key. Cache contents are
# not signed, and GitHub lets any job that runs in a writable scope create
# entries there. Since late 2026 only trusted triggers (push, schedule,
# workflow_dispatch, repository_dispatch, ...) may write the default branch's
# scope and pull_request_target is read-only, so this detector never asks to
# save from pull_request_target. A restored file is therefore DATA from a
# same-scope writer: it is accepted only in the exact shape written here, it
# can only change which changed paths the advisory overlap labels and
# relationship metadata see, and it is never executed. A file that is missing,
# not a regular file, unreadable or off-shape is ignored and every PR is read.
#
# Stop reading when GitHub refuses a read for the shared installation budget:
# the reset can be most of an hour away, every further request would be refused
# too, and GitHub warns that integrations which keep requesting while limited
# may be blocked. The rest are deferred exactly like the deadline defers them.

LOPU_PR_FILES_CACHE="${LOPU_PR_FILES_CACHE:-.lopu-pr-files-cache.json}"
LOPU_PR_FILES_TTL="${LOPU_PR_FILES_TTL:-86400}"
LOPU_PR_FILES_TOO_LARGE_TTL="${LOPU_PR_FILES_TOO_LARGE_TTL:-21600}"

# The exact shape complete_large_pr_files writes; prints its entries or fails.
# A readAt in the future (beyond clock skew) would never expire, so it fails.
# shellcheck disable=SC2016
LOPU_PR_FILES_CACHE_SHAPE='
  def entry_ok:
    type == "object"
    and ((keys - ["baseRefName","files","headRefOid","number","readAt","tooLarge"]) | length) == 0
    and (.number | type) == "number" and .number > 0 and .number == (.number | floor)
    and (.headRefOid | type) == "string" and (.headRefOid | test("^[0-9a-f]{40}$"))
    and (.baseRefName | type) == "string" and (.baseRefName | length) > 0
    and (.readAt | type) == "number" and .readAt >= 0 and .readAt <= $now + 300
    and (if has("tooLarge")
         then .tooLarge == true and (has("files") | not)
         else (.files | type) == "array" and all(.files[]; type == "string") end);
  if type == "object" and keys == ["entries","version"] and .version == 1
     and (.entries | type) == "array" and all(.entries[]; entry_ok)
     and ([.entries[].number] | unique | length) == (.entries | length)
  then .entries | sort_by(.number)
  else error("not a version 1 changed-file cache") end'

complete_large_pr_files() {
  local inventory="$1" number head base pages errors retries
  local deferred=0 deferred_numbers='' budget_out=0 budget_numbers=''
  local reads=0 requests=0 hits=0 large_hits=0 large_numbers=''
  local deadline="${FILES_INVENTORY_DEADLINE_SECONDS:-600}"
  # Read by gh_read_retry through bash's dynamic scope.
  # shellcheck disable=SC2034
  local LOPU_SLOW_DIFF_RETRY=false
  local now valid carried fresh next
  now="$(date +%s)"
  valid="$RUNNER_TEMP/lopu-pr-files-cache.valid.json"
  carried="$RUNNER_TEMP/lopu-pr-files-cache.carried.json"
  fresh="$RUNNER_TEMP/lopu-pr-files-cache.fresh.jsonl"
  next="$RUNNER_TEMP/lopu-pr-files-cache.next.json"
  echo '[]' >"$valid"
  : >"$fresh"
  if [ -f "$LOPU_PR_FILES_CACHE" ] && [ ! -L "$LOPU_PR_FILES_CACHE" ]; then
    if ! jq -c --argjson now "$now" "$LOPU_PR_FILES_CACHE_SHAPE" \
        "$LOPU_PR_FILES_CACHE" >"$valid" 2>/dev/null; then
      echo '[]' >"$valid"
      echo "::warning::Ignoring the restored changed-file cache: it is not the exact shape this detector writes, so every PR is read from GitHub this scan." >&2
    fi
  elif [ -e "$LOPU_PR_FILES_CACHE" ] || [ -L "$LOPU_PR_FILES_CACHE" ]; then
    echo "::warning::Ignoring the restored changed-file cache: it is not a regular file, so every PR is read from GitHub this scan." >&2
  fi

  # Entries still valid for a PR that needs paths: exact PR, head and base,
  # inside the TTL for its kind.
  jq -c --slurpfile cache "$valid" --argjson now "$now" \
    --argjson ttl "$LOPU_PR_FILES_TTL" --argjson large_ttl "$LOPU_PR_FILES_TOO_LARGE_TTL" '
    ($cache[0] | map({key: (.number | tostring), value: .}) | from_entries) as $by
    | [.[] | select(.filesIncomplete == true or .filesTotal > (.files | length)) as $pr
        | ($by[$pr.number | tostring] // empty)
        | select(.headRefOid == $pr.headRefOid and .baseRefName == $pr.baseRefName
                 and ($now - .readAt) < (if .tooLarge then $large_ttl else $ttl end))]
  ' <<<"$inventory" >"$carried"
  inventory="$(jq -c --slurpfile carried "$carried" '
    ($carried[0] | map(select(.files)) | map({key: (.number | tostring), value: .files})
      | from_entries) as $cached
    | map(($cached[.number | tostring]) as $files
          | if $files then . + {files:$files, filesTotal:($files | length), filesIncomplete:false}
            else . end)
  ' <<<"$inventory")"
  hits="$(jq '[.[] | select(.files)] | length' "$carried")"
  large_hits="$(jq '[.[] | select(.tooLarge)] | length' "$carried")"
  large_numbers="$(jq -r '[.[] | select(.tooLarge) | "#\(.number)"] | join(" ")' "$carried")"

  while IFS=: read -r number head base; do
    [ -n "$number" ] || continue
    if [ "$budget_out" -gt 0 ]; then
      budget_out="$(( budget_out + 1 ))"
      budget_numbers="$budget_numbers #$number"
      continue
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      deferred="$(( deferred + 1 ))"
      deferred_numbers="${deferred_numbers:+$deferred_numbers }#$number"
      continue
    fi
    pages="$RUNNER_TEMP/lopu-pr-files-$number.json"
    errors="$RUNNER_TEMP/lopu-pr-files-$number.err"
    reads="$(( reads + 1 ))"
    if ! gh_read_retry --paginate \
        "repos/$REPO/pulls/$number/files?per_page=100" --slurp >"$pages" 2>"$errors"; then
      cat "$errors" >&2
      retries="$(grep -c 'retrying in' "$errors" || true)"
      requests="$(( requests + 1 + retries ))"
      rm -f "$pages"
      echo "::warning::Could not complete the changed-file inventory for #$number; overlap labels use only its available changed paths (inventory incomplete)." >&2
      if grep -Eq 'HTTP 422([^0-9]|$)' "$errors" \
         && grep -Fq 'diff is taking too long to generate' "$errors" \
         && [[ "$head" =~ ^[0-9a-f]{40}$ ]] && [ -n "$base" ]; then
        jq -cn --argjson number "$number" --arg head "$head" --arg base "$base" --argjson now "$now" \
          '{number:$number, headRefOid:$head, baseRefName:$base, readAt:$now, tooLarge:true}' >>"$fresh"
      fi
      if [ -e "$RUNNER_TEMP/lopu-gh-budget-exhausted" ]; then
        budget_out=1
        budget_numbers="#$number"
      fi
      rm -f "$errors"
      continue
    fi
    cat "$errors" >&2
    retries="$(grep -c 'retrying in' "$errors" || true)"
    rm -f "$errors"
    requests="$(( requests + $(jq 'length' "$pages") + retries ))"
    inventory="$(jq -c \
      --argjson number "$number" \
      --slurpfile response "$pages" \
      '($response[0] | add // [] | map(.filename) | unique) as $files
       | map(if .number == $number
             then . + {files:$files, filesTotal:($files | length), filesIncomplete:false}
             else . end)' <<<"$inventory")"
    if [[ "$head" =~ ^[0-9a-f]{40}$ ]] && [ -n "$base" ]; then
      jq -cn --argjson number "$number" --arg head "$head" --arg base "$base" --argjson now "$now" \
        --slurpfile response "$pages" \
        '{number:$number, headRefOid:$head, baseRefName:$base, readAt:$now,
          files:($response[0] | add // [] | map(.filename) | unique)}' >>"$fresh"
    fi
    rm -f "$pages"
  done < <(jq -r --slurpfile carried "$carried" '
    ($carried[0] | map(select(.tooLarge) | .number)) as $large
    | .[] | select(.filesIncomplete == true or .filesTotal > (.files | length))
    | select(.number as $n | any($large[]; . == $n) | not)
    | "\(.number):\(.headRefOid // ""):\(.baseRefName)"' <<<"$inventory")

  if [ "$large_hits" -gt 0 ]; then
    echo "::warning::Reused $large_hits cached HTTP 422 \"diff is taking too long to generate\" result(s) at unchanged heads; their overlap labels use no changed paths (inventory incomplete) until the head or base changes or the ${LOPU_PR_FILES_TOO_LARGE_TTL}s re-probe: $large_numbers" >&2
  fi
  if [ "$budget_out" -gt 0 ]; then
    echo "::warning::GitHub's shared API budget refused the changed-file inventory; $budget_out PR(s) were not read and the next scan retries them (inventory incomplete):$budget_numbers" >&2
  fi
  if [ "$deferred" -gt 0 ]; then
    echo "::warning::The changed-file inventory reached its ${deadline}s budget with $deferred PR(s) un-hydrated; their overlap labels use no changed paths and the next scan retries them (inventory incomplete): $deferred_numbers" >&2
  fi
  echo "Changed-file inventory: $hits PR(s) reused from the cache, $large_hits cached diff-too-long, $reads read from GitHub in $requests REST request(s), $deferred deferred by the deadline, $(( budget_out > 0 ? budget_out - 1 : 0 )) skipped after a budget refusal." >&2

  # Carry forward only what is still exact and fresh, plus this scan's reads.
  # Entries for closed PRs, moved heads and retargets drop out on their own.
  jq -cn --slurpfile carried "$carried" --slurpfile fresh "$fresh" \
    '{version:1, entries:(($carried[0] + $fresh) | sort_by(.number))}' >"$next"
  if [ "$(jq -c '.entries' "$next")" != "$(jq -c '.' "$valid")" ] \
     && [ -n "${GITHUB_OUTPUT:-}" ] \
     && [ "${EVENT_NAME:-}" != pull_request_target ] \
     && [ "${PRIORITY_SYNC_EVENT:-false}" != true ]; then
    rm -f -- "$LOPU_PR_FILES_CACHE"
    cp "$next" "$LOPU_PR_FILES_CACHE"
    echo 'files_cache=save' >>"$GITHUB_OUTPUT"
  fi
  rm -f "$valid" "$carried" "$fresh" "$next"
  printf '%s\n' "$inventory"
}
