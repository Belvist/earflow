# Prerender: Node + Puppeteer (+ system Chromium). Debian slim.
# Security: non-root, no-new-privileges, read_only (docker-compose), no cookies.

FROM node:22.21.1-slim AS deps

WORKDIR /app

# System Chromium (avoids Puppeteer download + missing shared libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server.js ./

FROM node:22.21.1-slim AS production

WORKDIR /app

# Chromium runtime (no dev packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r nodejs && useradd -r -g nodejs -u 1001 nodejs

# Runtime: copy node_modules only (not Chrome — using system)
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nodejs:nodejs /app/package.json ./
COPY --from=deps --chown=nodejs:nodejs /app/server.js ./

USER nodejs

ENV NODE_ENV=production \
    PORT=3100 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3100/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
