# ---- deps: production-only node_modules, built for the runtime's platform ----
# better-sqlite3 ships a native addon that has to be compiled against the
# exact Node/OS combo it will run on, so this stage installs build tools,
# compiles it here, and the runtime stage below copies the result rather than
# rebuilding it a second time.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- build: type-check + compile TypeScript ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: slim image with just the compiled output + prod deps ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# data/ holds the SQLite settings db (see db/database.ts) — created here so
# the "node" user (see below) owns it before the volume is mounted over it.
RUN mkdir -p data && chown -R node:node /app
USER node
CMD ["node", "dist/app.js"]
