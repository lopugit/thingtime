#!/bin/bash


# export branch using

# if [ -f .env.auto ]; then
# 	export $(cat .env.auto | xargs)
# 	echo "THINGTIME_BRANCH_NAME is $THINGTIME_BRANCH_NAME"


if [ -f .env.auto ]; then
	export $(cat .env.auto | xargs)
	echo "THINGTIME_BRANCH_NAME is $THINGTIME_BRANCH_NAME"
	# create or append to .env file with THINGTIME_BRANCH_NAME env var
	if grep -q "THINGTIME_BRANCH_NAME" .env; then
		# replace existing line
		sed -i.bak "s/THINGTIME_BRANCH_NAME=.*/THINGTIME_BRANCH_NAME=\"$THINGTIME_BRANCH_NAME\"/" .env
		rm .env.bak
	# else if no .env create it !
	elif [ ! -f .env ]; then
		echo "THINGTIME_BRANCH_NAME=\"$THINGTIME_BRANCH_NAME\"" > .env
	else
		# append to bottom of .env
		echo "THINGTIME_BRANCH_NAME=\"$THINGTIME_BRANCH_NAME\"" >> .env
	fi
else
fi

