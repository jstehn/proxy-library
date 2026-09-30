# One image for both the web app and the worker (design doc 11, section 4).
# Build: docker compose build     Run: docker compose up -d     (see docs/deploy.md)

FROM node:22-bookworm-slim AS base
# The same pnpm as package.json's "packageManager" and the Nix shell.
RUN npm install --global pnpm@12.3.4 && npm cache clean --force
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies first, so a code change doesn't reinstall them.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# The build only needs configuration that parses; real values come at runtime. These are set for
# this one command, so none of them ends up in the image.
RUN DATABASE_URL=postgres://build@localhost/build \
    AUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime \
    APP_URL=http://localhost:3000 \
    IMAGE_CACHE_DIR=/data/images \
    SYNC_CACHE_DIR=/data/cache \
    pnpm exec next build

# The runtime keeps the full dependencies and the source: the worker runs TypeScript with tsx.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app ./
RUN mkdir -p /data/images /data/cache && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
