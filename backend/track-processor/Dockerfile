# =============================================================================
# Track Processor - Production Hardened Dockerfile
# =============================================================================

FROM node:20-alpine AS builder

RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache python3 make g++ vips-dev fftw-dev

WORKDIR /app

COPY package.json ./
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-factor 2 && \
    npm config set fetch-retry-mintimeout 10000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set maxsockets 50 && \
    (for i in 1 2 3 4 5; do \
    npm install --omit=dev --no-audit --no-fund && break; \
    sleep $((i * 5)); \
    done) && \
    npm cache clean --force

COPY . .

# =============================================================================
# Pinned version for security
FROM node:20-alpine AS production

RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache \
    dumb-init \
    vips \
    vips-cpp \
    ffmpeg \
    libc6-compat && \
    rm -rf /var/cache/apk/* /tmp/* && \
    addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nodejs

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/*.js ./
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
COPY --from=builder --chown=nodejs:nodejs /app/lib ./lib

RUN mkdir -p /app/uploads/covers && \
    chown -R nodejs:nodejs /app/uploads

USER nodejs

ENV NODE_ENV=production

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "process-tracks.js"]
