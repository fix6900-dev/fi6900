# FI6900 keeper — hosted deploy (Railway). Builds the SDK + keeper from the pnpm workspace and runs the API/scheduler.
# Config comes from env vars (see docs/devnet.md): KEEPER_KEYPAIR_JSON, STATIC_PRICES_JSON_INLINE, DB_PATH=/data/keeper.db, ...
FROM node:22-bookworm AS build
# pnpm via npm (not corepack: corepack's bundled node-gyp lacks the exec bit, which breaks better-sqlite3's native build).
RUN npm install -g pnpm@10.33.2 && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/keeper/package.json apps/keeper/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @fi6900/sdk... --filter @fi6900/keeper...
COPY packages/sdk packages/sdk
COPY apps/keeper apps/keeper
RUN pnpm --filter @fi6900/sdk build && pnpm --filter @fi6900/keeper build
# drop dev dependencies for the runtime image
RUN pnpm prune --prod --filter @fi6900/keeper... || true

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/keeper
RUN mkdir -p /data
ENV DB_PATH=/data/keeper.db PORT=8787
EXPOSE 8787
CMD ["node", "dist/index.js"]
