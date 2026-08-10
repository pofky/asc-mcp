# Glama and any other sandbox that wants a reproducible container build.
# The server speaks MCP over stdio, so there is no port and no healthcheck:
# the container is the process.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY skills ./skills
# No credentials baked in. Without ASC_ISSUER_ID and a .p8 the server still
# starts, in setup mode, and explains the fix through asc_setup_check.
ENTRYPOINT ["node", "dist/index.js"]
