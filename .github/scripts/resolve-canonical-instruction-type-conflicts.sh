#!/usr/bin/env bash
set -euo pipefail

# Git's distinct-type conflict representation is asymmetric: when a PR head
# carries a regular root instruction file and the target branch has replaced
# it with the canonical AI_ALL.md symlink, `git merge` leaves the target
# symlink at the original path and invents an unmerged `<path>~HEAD` sidecar
# for the historical regular file. Those sidecars contain no textual conflict
# markers, so an ordinary marker-based resolver cannot see or finish them.
#
# Normalize only this exact, fully proven repository migration. Everything
# else remains unmerged for Lopu or a human to judge.

expected_base="${1:-}"
if ! [[ "$expected_base" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::Canonical instruction normalization requires an exact target SHA."
  exit 1
fi
if ! merge_head="$(git rev-parse --verify MERGE_HEAD 2>/dev/null)" \
  || [ "$merge_head" != "$expected_base" ]; then
  echo "::error::Canonical instruction normalization requires the exact target merge to remain in progress."
  exit 1
fi

stage_record() {
  local path="$1" stage="$2"
  git ls-files -u -- "$path" \
    | awk -v wanted="$stage" '$3 == wanted { print $1 " " $2 }'
}

tree_record() {
  local treeish="$1" path="$2"
  git ls-tree "$treeish" -- "$path" \
    | awk '{ print $1 " " $3 }'
}

for canonical_path in AGENTS.md CLAUDE.md; do
  sidecars=()
  while IFS=$'\t' read -r _meta unmerged_path; do
    case "$unmerged_path" in
      "$canonical_path"~*) sidecars+=("$unmerged_path") ;;
    esac
  done < <(git ls-files -u)

  if [ "${#sidecars[@]}" -eq 0 ]; then
    continue
  fi
  if [ "${#sidecars[@]}" -ne 2 ] || [ "${sidecars[0]}" != "${sidecars[1]}" ]; then
    echo "::notice::$canonical_path has an unfamiliar distinct-type conflict shape; leaving it for semantic resolution."
    continue
  fi
  sidecar="${sidecars[0]}"

  original_stage3="$(stage_record "$canonical_path" 3)"
  original_stage1="$(stage_record "$canonical_path" 1)"
  original_stage2="$(stage_record "$canonical_path" 2)"
  sidecar_stage1="$(stage_record "$sidecar" 1)"
  sidecar_stage2="$(stage_record "$sidecar" 2)"
  sidecar_stage3="$(stage_record "$sidecar" 3)"
  base_record="$(tree_record "$expected_base" "$canonical_path")"
  head_record="$(tree_record HEAD "$canonical_path")"

  if [ -n "$original_stage1" ] || [ -n "$original_stage2" ] \
    || [ -z "$original_stage3" ] || [ "$original_stage3" != "$base_record" ] \
    || [ -z "$sidecar_stage1" ] || [ -z "$sidecar_stage2" ] \
    || [ -n "$sidecar_stage3" ] || [ "$sidecar_stage2" != "$head_record" ] \
    || [[ "$base_record" != 120000\ * ]] || [[ "$head_record" != 100644\ * ]]; then
    echo "::notice::$canonical_path does not match the proven canonical-symlink migration; leaving it unmerged."
    continue
  fi

  base_blob="${base_record#* }"
  if [ "$(git cat-file -p "$base_blob")" != AI_ALL.md ]; then
    echo "::notice::$canonical_path target symlink is not the canonical AI_ALL.md alias; leaving it unmerged."
    continue
  fi

  git checkout "$expected_base" -- "$canonical_path"
  git rm -fq --ignore-unmatch -- "$sidecar"
  if git ls-files -u -- "$canonical_path" "$sidecar" | grep -q .; then
    echo "::error::Canonical instruction normalization did not clear the proven $canonical_path type conflict."
    exit 1
  fi
  echo "::notice::Preserved the target branch's canonical $canonical_path -> AI_ALL.md symlink and removed Git's historical $sidecar sidecar."
done
