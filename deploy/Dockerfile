# Linux/amd64 manifest digest verified from the upstream Node registry.
FROM --platform=linux/amd64 node:24.22.1-bookworm-slim@sha256:e1582112fb9f152ed38eefcd712efc93fee1becb519fdfa57574d5e07eaa5e7d
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tini util-linux \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://pkgs.tailscale.com/stable/tailscale_1.104.7_amd64.tgz -o /tmp/tailscale.tgz \
    && echo 'e56693ff74a64f2591b7e819c280635a100aae1ddfb0ef058fcd052b7cd8d16c  /tmp/tailscale.tgz' | sha256sum -c - \
    && tar -xzf /tmp/tailscale.tgz -C /tmp \
    && install /tmp/tailscale_1.104.7_amd64/tailscale /tmp/tailscale_1.104.7_amd64/tailscaled /usr/local/bin/ \
    && rm -rf /tmp/tailscale*
RUN curl -fsSL https://github.com/openclaw/gogcli/releases/download/v0.48.0/gogcli_0.48.0_linux_amd64.tar.gz -o /tmp/gog.tgz \
    && echo '8809d2f4fe95a0299b1a2a5c6bc912c4aba4b90a7b5e2c1f5cf11b9945a50004  /tmp/gog.tgz' | sha256sum -c - \
    && tar -xzf /tmp/gog.tgz -C /tmp ./gog && install /tmp/gog /usr/local/bin/gog && rm /tmp/gog /tmp/gog.tgz
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY deploy/runtime/package.json deploy/runtime/package-lock.json /opt/openclaw/
RUN npm ci --prefix /opt/openclaw --omit=dev
COPY src ./src
COPY fixtures ./fixtures
RUN ln -s /opt/openclaw/node_modules src/plugin/node_modules \
    && node_modules/.bin/tsc -p src/plugin/tsconfig.json \
    && mkdir -p src/plugin/dist/fixtures && cp -R fixtures/. src/plugin/dist/fixtures/
COPY . .
RUN chmod -R a+rX /app \
    && mkdir -p /app/.runtime/host /data && ln -s /opt/openclaw/node_modules /app/.runtime/host/node_modules \
    && mkdir -p /var/run/tailscale \
    && chown -R node:node /data /app/.runtime /var/run/tailscale
# Files containing code remain root-owned; runtime state is the only writable tree.
USER node
ENV APPLYPILOT_ENV=production
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/bin/setpriv", "--no-new-privs", "--inh-caps=-all", "--ambient-caps=-all", "--"]
CMD ["node", "--import", "tsx", "deploy/assistant-runtime.mjs"]
