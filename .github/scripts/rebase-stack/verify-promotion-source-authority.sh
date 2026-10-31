#!/usr/bin/env bash

# Independently reproduce the promoter's allowed source-range choice from the
# immutable merge commit plus live source-PR commit/file metadata. No network.

set -euo pipefail
IFS=$'\n\t'

fail() {
  echo "::error::$*" >&2
  exit 1
}

[[ $# -eq 3 ]] || {
  echo "usage: $0 <isolated-repo-path> <pr-commits-json> <pr-files-json>" >&2
  exit 64
}
for name in GITHUB_OUTPUT RUNNER_TEMP SOURCE_START_SHA SOURCE_END_SHA; do
  [[ -n "${!name:-}" ]] || fail "$name is required."
done

repo_abs="$(builtin cd -- "$1" && pwd -P)"
runner_temp_abs="$(builtin cd -- "$RUNNER_TEMP" && pwd -P)"
case "$repo_abs/" in
  "$runner_temp_abs/"*) ;;
  *) fail "Source authority checkout must live under RUNNER_TEMP." ;;
esac
commits_json="$(builtin cd -- "$(dirname -- "$2")" && pwd -P)/$(basename -- "$2")"
files_json="$(builtin cd -- "$(dirname -- "$3")" && pwd -P)/$(basename -- "$3")"
case "$commits_json" in "$runner_temp_abs"/*) ;; *) fail "PR metadata must live under RUNNER_TEMP." ;; esac
case "$files_json" in "$runner_temp_abs"/*) ;; *) fail "PR metadata must live under RUNNER_TEMP." ;; esac

export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_ATTR_NOSYSTEM=1
builtin cd -- "$repo_abs"
git cat-file -e "$SOURCE_END_SHA^{commit}"

parent_record="$(git rev-list --parents -n 1 "$SOURCE_END_SHA")"
parent_count="$(awk '{ print NF - 1 }' <<<"$parent_record")"
(( parent_count >= 1 )) || fail "Source endpoint has no parent and cannot authorize a promotion patch."
first_parent="$(awk '{ print $2 }' <<<"$parent_record")"
expected_start="$first_parent"

if (( parent_count == 1 )); then
  commit_count="$(jq 'if type == "array" then length else -1 end' "$commits_json")"
  [[ "$commit_count" =~ ^[1-9][0-9]*$ ]] || fail "Live source PR commit metadata is empty or malformed."
  if (( commit_count > 1 )); then
    range_start="$(git rev-parse --verify "$SOURCE_END_SHA~$commit_count" 2>/dev/null || true)"
    if [[ "$range_start" =~ ^[0-9a-f]{40}$ ]]; then
      range_paths="$RUNNER_TEMP/promotion-authority-range-paths.json"
      # Match computePicks exactly: it uses Git's ordinary newline-separated
      # display for this rebase-range heuristic. Quoted non-ASCII names then
      # fail the PR-file equality check on both sides and safely select the
      # single commit parent instead.
      git diff --name-only "$range_start" "$SOURCE_END_SHA" \
        | node -e '
          const chunks=[]; process.stdin.on("data", c => chunks.push(c));
          process.stdin.on("end", () => {
            const paths=Buffer.concat(chunks).toString("utf8").split("\n").filter(Boolean);
            process.stdout.write(JSON.stringify([...new Set(paths)].sort()));
          });
        ' >"$range_paths" || fail "Could not derive the candidate source range paths."
      if RANGE_PATHS="$range_paths" PR_FILES="$files_json" node <<'NODE'
      const fs = require('node:fs');
      const range = JSON.parse(fs.readFileSync(process.env.RANGE_PATHS, 'utf8'));
      const raw = JSON.parse(fs.readFileSync(process.env.PR_FILES, 'utf8'));
      if (!Array.isArray(raw) || raw.some((p) => typeof p !== 'string' || /[\0-\x1f\x7f]/.test(p))) process.exit(2);
      const files = [...new Set(raw)].sort();
      process.exit(JSON.stringify(range) === JSON.stringify(files) && files.length > 0 ? 0 : 1);
NODE
      then
        expected_start="$range_start"
      fi
    fi
  fi
fi

[[ "$SOURCE_START_SHA" == "$expected_start" ]] \
  || fail "Source-start SHA is not the independently re-derived PR patch boundary."
printf 'source_authority=verified\n' >>"$GITHUB_OUTPUT"
