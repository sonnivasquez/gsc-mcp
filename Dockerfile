# Image Glama builds and runs for its safety and quality checks.
# https://glama.ai/mcp/methodology
#
# Glama clones the repo, builds this Dockerfile, and introspects the process
# over stdio (initialize, tools/list, resources/list, prompts/list). That
# handshake does not call Google, so the image contains no credentials and
# publishes no port.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
# package.json "build" invokes bun. build:node is the same tsc compile on Node.
RUN npm run build:node

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

USER node
CMD ["node", "dist/index.js"]
