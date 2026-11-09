# Build from the allowlisted staging context in docs/no-login-draft-preview.md.
# This image contains only the renderer and its locked Linux user. It must
# never receive an account checkout, dotenv or API key.
FROM mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48
USER root
WORKDIR /opt/thingtime/MCP
COPY MCP/package.json MCP/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY MCP/dist/ dist/
COPY remix/dist/draft-preview/ /opt/thingtime/remix/dist/draft-preview/
RUN node -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)' \
    && if [ ! -x /usr/local/bin/node ]; then ln -s "$(command -v node)" /usr/local/bin/node; fi \
    && test -x /usr/bin/setpriv \
    && test -x /usr/bin/id \
    && test -x /usr/bin/stat \
    && test -x /usr/bin/sha256sum \
    && test -f dist/renderJob.js \
    && test -f /opt/thingtime/remix/dist/draft-preview/runner.js \
    && chown -R root:root /opt/thingtime /ms-playwright \
    && chmod -R a-w /opt/thingtime /ms-playwright \
    && groupadd --gid 10001 thingtime-renderer \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin thingtime-renderer \
    && usermod --lock thingtime-renderer \
    && chmod 0700 /home/thingtime-renderer
ENV HOME=/home/thingtime-renderer
USER thingtime-renderer
WORKDIR /home/thingtime-renderer
