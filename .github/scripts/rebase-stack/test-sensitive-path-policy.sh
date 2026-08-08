#!/usr/bin/env bash

# Regression fixture: filename sensitivity is review metadata, not a reason to
# withhold an otherwise eligible regular-text rebase conflict from the model.

set -euo pipefail
IFS=$'\n\t'

script_dir="$(builtin cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
prepare_script="$script_dir/prepare-round.sh"
fixture_root="$(mktemp -d)"
runner_temp="$fixture_root/runner"
repo="$runner_temp/repo"
scratch="$fixture_root/scratch"
round="$runner_temp/round"
output="$fixture_root/github-output"

cleanup() {
  [[ -n "$fixture_root" && "$fixture_root" == /tmp/* || "$fixture_root" == /var/* ]] || return
  rm -rf -- "$fixture_root"
}
trap cleanup EXIT

mkdir -p -- "$repo" "$scratch" "$round"
git -C "$repo" init -q -b base
git -C "$repo" config user.name fixture
git -C "$repo" config user.email fixture@example.invalid
git -C "$repo" config merge.conflictStyle zdiff3

paths=(
  .github/workflows/test.yml
  AGENTS.md
  package.json
  .env.example
  vite.config.ts
  src/example.ts
)

write_revision() {
  local revision="$1" path
  for path in "${paths[@]}"; do
    mkdir -p -- "$repo/$(dirname -- "$path")"
    printf '%s revision for %s\n' "$revision" "$path" >"$repo/$path"
  done
}

write_revision ancestor
git -C "$repo" add -- "${paths[@]}"
git -C "$repo" commit -qm ancestor

git -C "$repo" switch -qc feature
write_revision head
git -C "$repo" add -- "${paths[@]}"
git -C "$repo" commit -qm head

git -C "$repo" switch -q base
write_revision base
git -C "$repo" add -- "${paths[@]}"
git -C "$repo" commit -qm base

git -C "$repo" switch -q feature
if git -C "$repo" rebase base >/dev/null 2>&1; then
  echo "fixture did not create the expected conflicts" >&2
  exit 1
fi

RUNNER_TEMP="$runner_temp" \
GITHUB_WORKSPACE="$scratch" \
GITHUB_OUTPUT="$output" \
  "$prepare_script" "$repo" "$scratch" "$round"

grep -qxF 'needs_ai=true' "$output"
for path in "${paths[@]}"; do
  [[ -f "$scratch/$path" ]] || {
    echo "eligible conflict was not copied to scratch: $path" >&2
    exit 1
  }
done

expected="$fixture_root/expected-sensitive"
printf '%s\n' \
  .env.example \
  .github/workflows/test.yml \
  AGENTS.md \
  package.json \
  vite.config.ts \
  | LC_ALL=C sort -u >"$expected"
actual="$fixture_root/actual-sensitive"
awk '
  /^sensitive_conflict_paths<</ {
    delimiter = $0
    sub(/^sensitive_conflict_paths<</, "", delimiter)
    capture = 1
    next
  }
  capture && $0 == delimiter { exit }
  capture { print }
' "$output" >"$actual"
diff -u -- "$expected" "$actual"
if grep -qxF 'src/example.ts' "$actual"; then
  echo "ordinary source path was incorrectly marked for focused review" >&2
  exit 1
fi

echo "sensitive-path advisory fixture passed"
