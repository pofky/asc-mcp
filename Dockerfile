# Glama and any other sandbox that wants a reproducible container build.
# The server speaks MCP over stdio, so there is no port and no healthcheck:
# the container is the process.
#
# One install, not two. The runtime stage used to run its own `npm ci --omit=dev`,
# which doubled the slowest step in the build for a tree of two runtime
# dependencies. The build stage now installs once and prunes to production, and
# the runtime stage copies the pruned tree. `--no-audit --no-fund` drop two
# network round trips that cannot change the result.
FROM node:22-alpine AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY skills ./skills
# No credentials baked in. Without ASC_ISSUER_ID and a .p8 the server still
# starts, in setup mode, and explains the fix through asc_setup_check.
ENTRYPOINT ["node", "dist/index.js"]
