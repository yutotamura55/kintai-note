FROM node:22-bookworm-slim

WORKDIR /workspace
# System libraries for the headless Chromium used by the passkey flow test in npm run test:local.
# The browser itself is downloaded into node_modules by that test, so it follows package-lock.json.
RUN npx -y playwright@1.63.0 install-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm
RUN mkdir -p /workspace/node_modules /workspace/.nuxt \
    && chown node:node /workspace /workspace/node_modules /workspace/.nuxt

COPY --chown=node:node . .

ENV NODE_ENV=development
EXPOSE 3000

USER node
CMD ["sleep", "infinity"]
