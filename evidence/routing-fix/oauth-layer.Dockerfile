FROM us-west1-docker.pkg.dev/amplified-coder-510723-p3/applypilot/runtime@sha256:e7cdaeb8fee94df39729e4829c80bbf6904df70ab77f23de2e6da375e642aad7
COPY --chown=root:root local-gateway.mjs /app/scripts/local-gateway.mjs
