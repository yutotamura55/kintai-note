FROM node:22-bookworm-slim

WORKDIR /workspace
RUN mkdir -p /workspace/node_modules /workspace/.nuxt \
    && chown node:node /workspace /workspace/node_modules /workspace/.nuxt

COPY --chown=node:node . .

ENV NODE_ENV=development
EXPOSE 3000

USER node
CMD ["sleep", "infinity"]
