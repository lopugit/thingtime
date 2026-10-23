#!/usr/bin/env bash

# Resolves THINGTIME_BRANCH_NAME for the app.
#
# On Vercel the branch comes from the VERCEL_GIT_COMMIT_REF system env var,
# which Vercel provides to both the build step and runtime functions, so
# nothing is read from or written to disk there.
#
# Locally the current git branch is written to .env.auto (untracked,
# generated) and to a managed block in .env so scripts/dev.mjs and the PM2
# stack pick it up.

if [ -n "${VERCEL_ENV:-}" ]; then
	BRANCH_NAME="${VERCEL_GIT_COMMIT_REF:-${THINGTIME_BRANCH_NAME:-}}"
	if [ -z "$BRANCH_NAME" ]; then
		echo "Warning: VERCEL_GIT_COMMIT_REF is not set; branch name will fall back to git/unknown at runtime."
	else
		echo "THINGTIME_BRANCH_NAME is $BRANCH_NAME (from Vercel system env)"
	fi
	exit 0
fi

BRANCH_NAME=$(git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/\1/')
echo "THINGTIME_BRANCH_NAME is $BRANCH_NAME"

if [[ "$BRANCH_NAME" == *"unknown"* || -z "$BRANCH_NAME" ]]; then
	echo "Warning: could not determine local branch name; leaving existing .env.auto untouched."
else
	echo "THINGTIME_BRANCH_NAME=\"$BRANCH_NAME\"" > .env.auto

	env_marker="##### Auttomatic .env vars see pre-dev.sh #####"
	# Replace only the managed block, preserving any user-defined lines after it.
	if [ -f .env ] && [ "$(grep -cF "$env_marker" .env)" -ge 2 ]; then
		awk -v marker="$env_marker" '
			$0 == marker && !removed {
				in_block = 1
				removed = 1
				next
			}
			$0 == marker && in_block {
				in_block = 0
				next
			}
			!in_block {
				print
			}
		' .env > .env.tmp && mv .env.tmp .env
	fi
	{
		echo "$env_marker"
		echo "THINGTIME_BRANCH_NAME=\"$BRANCH_NAME\""
		echo "$env_marker"
	} >> .env
fi
