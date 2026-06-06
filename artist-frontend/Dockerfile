# =============================================================================
# Artist Frontend Dockerfile - Production Build with Nginx
# =============================================================================

FROM node:22.21.1-alpine AS builder

WORKDIR /app

ARG NPM_REGISTRY
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

COPY package.json package-lock.json ./

RUN set -e; \
  if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; else npm config set registry "https://registry.npmjs.org/"; fi && \
  if [ -n "$HTTP_PROXY" ]; then npm config set proxy "$HTTP_PROXY"; fi && \
  if [ -n "$HTTPS_PROXY" ]; then npm config set https-proxy "$HTTPS_PROXY"; fi && \
  npm config set fetch-timeout 600000 && \
  npm config set fetch-retries 5 && \
  npm config set fetch-retry-factor 2 && \
  npm config set fetch-retry-mintimeout 10000 && \
  npm config set fetch-retry-maxtimeout 120000 && \
  npm config set maxsockets 50 && \
  ok=; \
  for i in 1 2 3 4 5; do \
  if npm ci --ignore-scripts --no-audit --no-fund; then ok=1; break; fi; \
  sleep $((i * 5)); \
  done; \
  if [ "$ok" != "1" ]; then exit 1; fi; \
  test -x node_modules/.bin/react-scripts; \
  npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV GENERATE_SOURCEMAP=false
ENV CI=true

RUN npm run build

FROM nginx:1.27-alpine AS production

RUN apk update && apk upgrade --no-cache && \
  apk add --no-cache wget && \
  rm -rf /var/cache/apk/*

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN mkdir -p /docker-entrypoint.d && \
  printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  '' \
  'BOT_USERNAME="${EARFLOW_TELEGRAM_BOT_USERNAME:-${REACT_APP_TELEGRAM_BOT_USERNAME:-}}"' \
  'CSRF_COOKIE_NAME="${EARFLOW_ARTIST_CSRF_COOKIE_NAME:-mp_csrf_artists}"' \
  'ESCAPED_BOT_USERNAME=$(printf %s "$BOT_USERNAME" | sed -e "s/\\\\/\\\\\\\\/g" -e "s/\"/\\\\\"/g")' \
  'ESCAPED_CSRF_COOKIE_NAME=$(printf %s "$CSRF_COOKIE_NAME" | sed -e "s/\\\\/\\\\\\\\/g" -e "s/\"/\\\\\"/g")' \
  'cat > /tmp/runtime-config.js <<EOF' \
  'window.__EARFLOW_ARTIST_RUNTIME_CONFIG__ = Object.freeze({ telegramBotUsername: "'$ESCAPED_BOT_USERNAME'", csrfCookieName: "'$ESCAPED_CSRF_COOKIE_NAME'" });' \
  'EOF' \
  > /docker-entrypoint.d/40-runtime-config.sh && \
  chmod +x /docker-entrypoint.d/40-runtime-config.sh

COPY --from=builder /app/build /usr/share/nginx/html

RUN addgroup -g 1001 -S nginx-app && \
  adduser -S -u 1001 -G nginx-app nginx-app && \
  chown -R nginx-app:nginx-app /usr/share/nginx/html && \
  mkdir -p /var/cache/nginx/client_temp && \
  mkdir -p /var/cache/nginx/proxy_temp && \
  mkdir -p /var/cache/nginx/fastcgi_temp && \
  mkdir -p /var/cache/nginx/uwsgi_temp && \
  mkdir -p /var/cache/nginx/scgi_temp && \
  chown -R nginx-app:nginx-app /var/cache/nginx && \
  chown -R nginx-app:nginx-app /var/log/nginx && \
  mkdir -p /var/run/nginx && \
  chown -R nginx-app:nginx-app /var/run && \
  sed -i 's/^user /#user /' /etc/nginx/nginx.conf && \
  sed -i 's|/var/run/nginx.pid|/var/run/nginx/nginx.pid|' /etc/nginx/nginx.conf

USER nginx-app

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3005/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
