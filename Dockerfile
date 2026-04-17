# GO CANDID8 — server + pipeline runtime image.
# Single-stage build. Deploys the Express server from the monorepo so the
# pipeline subprocess (spawned via tsx at runtime) can resolve ../pipeline
# relative to server/dist/. Chromium is installed at system level so
# Puppeteer uses it instead of its 200MB bundled download.
#
# Used by Railway (auto-detected over Railpack/Nixpacks) and portable to
# any other Docker host (Fly, Render, self-hosted, etc.).
FROM node:20-slim

# ── System deps ─────────────────────────────────────────────────────────
# chromium + its transitive X/GL/audio libs are required by Puppeteer.
# build-essential + python3 are needed for any native npm modules that
# still ship with a postinstall compile step (better-sqlite3 legacy, etc.).
# Everything else is minimal runtime support (certs, fonts).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libnspr4 \
    libxss1 \
    fonts-liberation \
    ca-certificates \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# ── Puppeteer env ───────────────────────────────────────────────────────
# Skip the bundled Chromium download (handled by the apt chromium above)
# and tell Puppeteer where to find the system binary. Must be set BEFORE
# `npm ci` runs, otherwise Puppeteer's postinstall tries to download.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    # npm's output noise pollutes Railway log panels — quiet it down.
    npm_config_fund=false \
    npm_config_audit=false \
    npm_config_loglevel=warn

WORKDIR /app

# ── Install deps first for Docker layer caching ─────────────────────────
# Copy only the manifests so a code-only edit doesn't invalidate this
# layer. Every `npm ci` takes 60-90s; we only want to pay that when the
# lockfile actually changes.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY pipeline/package.json pipeline/

# Install all workspaces. --include=dev keeps tsc + tsx available for the
# server build + pipeline subprocess. We could prune after build, but
# because the pipeline runs TypeScript source directly via tsx at runtime,
# tsx + its peer deps must stay in the final image.
RUN npm ci --include=dev --workspaces

# ── Copy source + build server ──────────────────────────────────────────
COPY . .

# Only the server needs a build step; the pipeline uses tsx to execute
# .ts files directly at runtime. Client is deployed separately to Vercel.
RUN npm run build --workspace=server

# ── Runtime ─────────────────────────────────────────────────────────────
# Railway sets $PORT to whatever port it's proxying; server reads it from
# env and falls back to 3001 if unset.
EXPOSE 3001

CMD ["node", "server/dist/index.js"]
