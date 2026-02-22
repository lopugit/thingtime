echo "Hello"

# output the current git branch to an env var for use in the app

# use 
# git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/ 🌱 \1/'
# to get the current branch name

# old method doesn't work in CI
# BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
# BRANCH_NAME=$(git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/ 🌱 \1/')
BRANCH_NAME=$(git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/\1/')
echo "THINGTIME_BRANCH_NAME is $BRANCH_NAME"
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