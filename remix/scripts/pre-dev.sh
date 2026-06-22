echo "Hello"

# output the current git branch to an env var for use in the app

# use 
# git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/ 🌱 \1/'
# to get the current branch name

# old method doesn't work in CI
# BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
# BRANCH_NAME=$(git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/ 🌱 \1/')
# if in vercel env just grab from committed .env.auto
inVercel=${VERCEL_ENV:-}
# if inVercel not null
if [ -n "$inVercel" ]; then
	echo "In Vercel environment, using branch name from Vercel system env"
	BRANCH_NAME="${VERCEL_GIT_COMMIT_REF:-${THINGTIME_BRANCH_NAME:-}}"
	if [ -f .env.auto ]; then
		export $(cat .env.auto | xargs)
		BRANCH_NAME="${BRANCH_NAME:-$THINGTIME_BRANCH_NAME}"
	fi
	if [ -z "$BRANCH_NAME" ]; then
		echo "Error: could not determine THINGTIME_BRANCH_NAME. Exiting."
		exit 1
	fi
	export THINGTIME_BRANCH_NAME="$BRANCH_NAME"
	echo "THINGTIME_BRANCH_NAME is $THINGTIME_BRANCH_NAME"

	# replace process.env.THINGTIME_BRANCH_NAME with string value in all files within ../app
	find ./app -type f -name "*.tsx" -o -name "*.ts" -o -name "*.jsx" -o -name "*.js" | xargs sed -i.bak "s/process.env.THINGTIME_BRANCH_NAME/\"$THINGTIME_BRANCH_NAME\"/g"
	# remove .bak files
	find ./app -type f -name "*.bak" -delete

	exit 0
fi

BRANCH_NAME=$(git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/\1/')
echo "THINGTIME_BRANCH_NAME is $BRANCH_NAME"

# stop script if output contains unknown
if [[ "$BRANCH_NAME" == *"unknown"* ]]; then
	echo "Error: Branch name contains 'unknown'. Exiting."
	# export branch name from .env.auto if it already exists
	if [ -f .env.auto ]; then
		export $(cat .env.auto | xargs)
	fi
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
	export BRANCH_NAME
fi
