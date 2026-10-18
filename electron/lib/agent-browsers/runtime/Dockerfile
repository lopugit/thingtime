# Browsers are downloaded while building an image with no user credentials.
# The default task has network=none. Explicit external-network tasks receive
# their own bridge; restricted tasks install a kernel firewall before launch.
FROM mongo:8.0-noble@sha256:c2d54fddfb3738fb27fe117f51692e3f44e640a3e7aeb8da3937ee9cd33a650b AS database
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
USER root
WORKDIR /opt/thingtime-browser
RUN apt-get update && apt-get install -y --no-install-recommends nftables libcurl4t64 libssl3t64 python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild bcrypt --build-from-source && npm cache clean --force
COPY --from=database /usr/bin/mongod /usr/local/bin/mongod
COPY install.mjs runtime.cjs application.cjs browser-driver.cjs ./
COPY --chown=pwuser:pwuser app /opt/thingtime-app
# Nitro traces the host's native bcrypt binary. Use the Linux binary built from
# the same pinned package instead; no host-native addon executes in the task.
RUN if test -f /opt/thingtime-app/server/index.mjs; then cp node_modules/bcrypt/lib/binding/napi-v3/bcrypt_lib.node /opt/thingtime-app/server/node_modules/bcrypt/lib/binding/napi-v3/bcrypt_lib.node; fi
ARG BROWSER=chromium
ARG BUILD_ID=playwright-1.64.0
RUN node install.mjs "$BROWSER" "$BUILD_ID"
USER pwuser
ENV HOME=/home/pwuser
ENTRYPOINT ["node", "/opt/thingtime-browser/runtime.cjs"]
