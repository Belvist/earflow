FROM node:22.21.1-alpine AS deps

WORKDIR /app

# Chromium для Puppeteer (alpine). Без root: создаём пользователя сразу.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji \
  && rm -rf /var/cache/apk/*

COPY package.json ./
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server.js ./

FROM node:22.21.1-alpine AS production

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
  && rm -rf /var/cache/apk/* \
  && addgroup -g 1001 -S nodejs \
  && adduser -S -u 1001 -G nodejs nodejs

WORKDIR /app

COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nodejs:nodejs /app/package.json ./
COPY --from=deps --chown=nodejs:nodejs /app/server.js ./

USER nodejs

ENV NODE_ENV=production \
    PORT=3100 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    # Chromium в контейнере без root (Audited image pattern)
    CHROME_DEVEL_SANDBOX=off

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3100/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
