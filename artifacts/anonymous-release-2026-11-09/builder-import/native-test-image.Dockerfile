FROM thingtime-mica-render:node-csp-export
COPY bcrypt /opt/thingtime-qa-native/node_modules/bcrypt
COPY node-gyp-build /opt/thingtime-qa-native/node_modules/node-gyp-build
RUN node -e 'const bcrypt=require("/opt/thingtime-qa-native/node_modules/bcrypt");if(!bcrypt.compareSync("task-native-check",bcrypt.hashSync("task-native-check",4)))process.exit(1)'
