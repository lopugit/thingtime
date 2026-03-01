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
	echo "In Vercel environment, using branch name from .env.auto"
	if [ -f .env.auto ]; then
		export $(cat .env.auto | xargs)
		echo "THINGTIME_BRANCH_NAME is $THINGTIME_BRANCH_NAME"
		
		# replace process.env.THINGTIME_BRANCH_NAME with string value in all files within ../app
		find ../app -type f -name "*.tsx" -o -name "*.ts" -o -name "*.jsx" -o -name "*.js" | xargs sed -i.bak "s/process.env.THINGTIME_BRANCH_NAME/\"$THINGTIME_BRANCH_NAME\"/g"
		# remove .bak files
		find ../app -type f -name "*.bak" -delete
		
	else
		echo "Error: .env.auto file not found. Exiting."
		exit 1
	fi
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

	# append to bottom of .env with ##### Auttomatic .env vars see pre-dev.sh ##### opening and closing tags
	# not just like: echo "##### Auttomatic .env vars see pre-dev.sh #####" >> .env
	# but replace existing section if it exists
	if grep -q "##### Auttomatic .env vars see pre-dev.sh #####" .env; then
		# replace existing section
		sed -i.bak '/##### Auttomatic .env vars see pre-dev.sh #####/,$d' .env
		rm .env.bak
	fi
	{
		echo "##### Auttomatic .env vars see pre-dev.sh #####"
		echo "THINGTIME_BRANCH_NAME=\"$BRANCH_NAME\""
		echo "##### Auttomatic .env vars see pre-dev.sh #####"
	} >> .env
	export BRANCH_NAME
fi
