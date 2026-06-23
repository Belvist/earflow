# =============================================================================
# Recommendations Service - Production Hardened Dockerfile
# =============================================================================

FROM node:22.21.1-alpine AS builder

RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-factor 2 && \
    npm config set fetch-retry-mintimeout 10000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set maxsockets 50 && \
    (for i in 1 2 3 4 5; do \
    npm install --ignore-scripts --no-audit --no-fund && break; \
    sleep $((i * 5)); \
    done) && \
    npm cache clean --force

COPY . .

RUN npm prune --production && \
    rm -rf tests/ .eslintrc.js .env* *.md .git .gitignore

# =============================================================================
# Pinned version for security
FROM node:22.21.1-alpine AS production

RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache dumb-init && \
    rm -rf /var/cache/apk/* /tmp/* && \
    addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nodejs

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/*.js ./
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
COPY --from=builder --chown=nodejs:nodejs /app/workers ./workers
COPY --from=builder --chown=nodejs:nodejs /app/lib ./lib
COPY --from=builder --chown=nodejs:nodejs /app/config ./config
COPY --from=builder --chown=nodejs:nodejs /app/routes ./routes
COPY --from=builder --chown=nodejs:nodejs /app/middleware ./middleware
COPY --from=builder --chown=nodejs:nodejs /app/services ./services
COPY --from=builder --chown=nodejs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nodejs:nodejs /app/migrations ./migrations

RUN mkdir -p /app/logs && \
    chown nodejs:nodejs /app/logs

USER nodejs

ENV NODE_ENV=production \
    PORT=3006 \
    LOG_LEVEL=info

EXPOSE 3006 3016 3017

HEALTHCHECK --interval=15s --timeout=10s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3006/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
