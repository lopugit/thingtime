#!/usr/bin/env bash

# Regression fixture: the trusted rebase reviewer helper must preserve every
# accepted path while keeping each GitHub comment comfortably below 65,536 B.

set -euo pipefail
IFS=$'\n\t'

repo_root="$(git rev-parse --show-toplevel)"
rebase_workflow="$repo_root/.github/workflows/rebase-pr-stacks.yml"
merge_workflow="$repo_root/.github/workflows/resolve-pr-conflicts.yml"
fixture_root="$(mktemp -d)"

cleanup() {
  [[ -n "$fixture_root" && ( "$fixture_root" == /tmp/* || "$fixture_root" == /var/* ) ]] || return
  rm -rf -- "$fixture_root"
}
trap cleanup EXIT

mkdir -p -- "$fixture_root/bin"
extract_helper() {
  local workflow="$1"
  local step_name="$2"
  RUNNER_TEMP="$fixture_root" GITHUB_ENV="$fixture_root/env" bash < <(
  ruby -ryaml -e '
    step_name = ARGV.fetch(1)
    workflow = YAML.load_file(ARGV.fetch(0))
    step = workflow.fetch("jobs").fetch("rebase").fetch("steps").find do |candidate|
      candidate["name"] == step_name
    end
    abort("trusted path-comment helper step is missing") unless step
    print step.fetch("run")
  ' "$workflow" "$step_name"
  )
}

extract_helper \
  "$rebase_workflow" \
  "Prepare the trusted sensitive-path comment helper"

# The merge workflow uses a differently named job and helper variable, but the
# same bounded-delivery contract.
RUNNER_TEMP="$fixture_root" GITHUB_ENV="$fixture_root/env" bash < <(
  ruby -ryaml -e '
    workflow = YAML.load_file(ARGV.fetch(0))
    step = workflow.fetch("jobs").fetch("resolve").fetch("steps").find do |candidate|
      candidate["name"] == "Prepare the trusted merge-review comment helper"
    end
    abort("trusted merge-review helper step is missing") unless step
    print step.fetch("run")
  ' "$merge_workflow"
)
# shellcheck disable=SC1090,SC1091
source "$fixture_root/env"

cat >"$fixture_root/bin/gh" <<'FAKE_GH'
#!/usr/bin/env bash
set -euo pipefail
method=POST
body=''
endpoint=''
paginate=false
previous=''
for arg in "$@"; do
  if [[ "$previous" == --method ]]; then
    method="$arg"
  fi
  case "$arg" in
    --paginate) paginate=true ;;
    repos/*) endpoint="$arg" ;;
    body=@*) body="${arg#body=@}" ;;
  esac
  previous="$arg"
done

if [[ "$paginate" == true ]]; then
  shopt -s nullglob
  bodies=("$FAKE_GH_BODY_DIR"/body-*.md)
  if (( ${#bodies[@]} == 0 )); then
    printf '[]\n'
  else
    for existing in "${bodies[@]}"; do
      id="${existing##*/body-}"
      id="${id%.md}"
      jq -Rs --argjson id "$id" \
        '{id:$id,user:{login:"github-actions[bot]"},body:.}' \
        <"$existing"
    done | jq -s '[.]'
  fi
  exit 0
fi

case "$method" in
  PATCH)
    [[ -n "$body" ]]
    id="${endpoint##*/}"
    cp -- "$body" "$FAKE_GH_BODY_DIR/body-$id.md"
    ;;
  DELETE)
    id="${endpoint##*/}"
    rm -f -- "$FAKE_GH_BODY_DIR/body-$id.md"
    ;;
  POST)
    [[ -n "$body" ]]
    next_file="$FAKE_GH_BODY_DIR/next-id"
    if [[ -f "$next_file" ]]; then
      next_id="$(<"$next_file")"
    else
      next_id=1
    fi
    cp -- "$body" "$FAKE_GH_BODY_DIR/body-$next_id.md"
    printf '%s\n' "$((next_id + 1))" >"$next_file"
    ;;
  *)
    echo "unexpected fake gh method: $method" >&2
    exit 1
    ;;
esac
FAKE_GH
chmod 0700 "$fixture_root/bin/gh"

audit="$fixture_root/audit"
: >"$audit"
for i in $(seq 1 2000); do
  printf '.github/workflows/reviewer-path-%04d-%050d.yml\n' "$i" "$i" >>"$audit"
done
printf '.github/workflows/reviewer-&-<tag>.yml\n' >>"$audit"

exercise_helper() {
  local helper="$1"
  local fixture_name="$2"
  local bodies="$fixture_root/bodies-$fixture_name"
  mkdir -- "$bodies"

  PATH="$fixture_root/bin:$PATH" \
  RUNNER_TEMP="$fixture_root" \
  GITHUB_RUN_ID=123 \
  GH_TOKEN=dummy \
  FAKE_GH_BODY_DIR="$bodies" \
    "$helper" \
      "$audit" lopugit/thingtime 99 https://example.invalid/run published \
      '⚠️ **Focused review: configuration/security-adjacent conflicts**' \
      'Fixture description.'

  comment_count="$(find "$bodies" -type f -name 'body-*.md' | wc -l | tr -d ' ')"
  (( comment_count > 1 )) || {
    echo "$fixture_name: long review list was not split" >&2
    exit 1
  }
  for body in "$bodies"/*.md; do
    bytes="$(wc -c <"$body")"
    (( bytes < 65536 )) || {
      echo "$fixture_name: oversized review comment: $bytes bytes" >&2
      exit 1
    }
  done

  grep -h '^- <code>' "$bodies"/*.md \
    | sed -e 's|^- <code>||' -e 's|</code>$||' \
    | LC_ALL=C sort >"$fixture_root/actual-$fixture_name"
  sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' "$audit" \
    | LC_ALL=C sort >"$fixture_root/expected-$fixture_name"
  diff -u -- \
    "$fixture_root/expected-$fixture_name" \
    "$fixture_root/actual-$fixture_name"

  short_audit="$fixture_root/short-audit-$fixture_name"
  head -n 2 "$audit" >"$short_audit"
  PATH="$fixture_root/bin:$PATH" \
  RUNNER_TEMP="$fixture_root" \
  GITHUB_RUN_ID=123 \
  GH_TOKEN=dummy \
  FAKE_GH_BODY_DIR="$bodies" \
    "$helper" \
      "$short_audit" lopugit/thingtime 99 https://example.invalid/run published \
      '⚠️ **Focused review: configuration/security-adjacent conflicts**' \
      'Fixture description.'
  remaining="$(find "$bodies" -type f -name 'body-*.md' | wc -l | tr -d ' ')"
  (( remaining == 1 )) || {
    echo "$fixture_name: stale retry comment parts were not removed" >&2
    exit 1
  }
  grep '^- <code>' "$bodies"/body-1.md \
    | sed -e 's|^- <code>||' -e 's|</code>$||' \
    | LC_ALL=C sort >"$fixture_root/actual-short-$fixture_name"
  LC_ALL=C sort "$short_audit" >"$fixture_root/expected-short-$fixture_name"
  diff -u -- \
    "$fixture_root/expected-short-$fixture_name" \
    "$fixture_root/actual-short-$fixture_name"

  echo "$fixture_name path-comment chunk fixture passed ($comment_count comments; retry pruned to $remaining)"
}

exercise_helper "$SENSITIVE_COMMENT_HELPER" rebase
exercise_helper "$MERGE_REVIEW_COMMENT_HELPER" merge
