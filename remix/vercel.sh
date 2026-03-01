#!/bin/bash


# export branch using

# if [ -f .env.auto ]; then
# 	export $(cat .env.auto | xargs)
# 	echo "THINGTIME_BRANCH_NAME is $THINGTIME_BRANCH_NAME"


if [ -f .env.auto ]; then
	export $(cat .env.auto | xargs)
	echo "THINGTIME_BRANCH_NAME is $THINGTIME_BRANCH_NAME"
else
fi

