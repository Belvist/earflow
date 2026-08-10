# Prerender: Node + Puppeteer (+ bundled Chrome). Works on any distro.
# Security: non-root, no-new-privileges, read_only (docker-compose), no cookies.

FROM node:22.21.1 AS deps

WORKDIR /app

# Install production deps (Puppeteer downloads Chrome automatically)
COPY package.json package-lock.json ./
ENV PUPPETEER_CACHE_DIR=/app/.puppeteer
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server.js ./

FROM node:22.21.1-slim AS production

WORKDIR /app

# Create non-root user
RUN groupadd -r nodejs && useradd -r -g nodejs -u 1001 nodejs

# Runtime: copy node_modules + Chrome
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nodejs:nodejs /app/.puppeteer /app/.puppeteer
COPY --from=deps --chown=nodejs:nodejs /app/package.json ./
COPY --from=deps --chown=nodejs:nodejs /app/server.js ./

USER nodejs

ENV NODE_ENV=production \
    PORT=3100 \
    PUPPETEER_CACHE_DIR=/app/.puppeteer \
    # Use Puppeteer-bundled Chrome (full, no crashpad issues)
    PUPPETEER_EXECUTABLE_PATH=""

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3100/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
