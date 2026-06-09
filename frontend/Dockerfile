# =============================================================================
# Frontend Dockerfile - Production Build with Nginx
# =============================================================================
# Security features:
# - Multi-stage build: Node для сборки, Nginx для раздачи
# - Non-root user execution
# - Minimal attack surface (только статика + nginx)
# - Gzip compression, caching headers
# =============================================================================

# =============================================================================
# Stage 1: Build React app
# =============================================================================
FROM node:22.21.1-alpine AS builder

WORKDIR /app

ARG NPM_REGISTRY
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

# Copy package files first (better caching)
COPY package.json package-lock.json ./

# Install dependencies
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
  test -x node_modules/.bin/craco; \
  npm cache clean --force

# Copy source code
COPY . .

# CRA inlines REACT_APP_* at build time (not runtime env).
ARG REACT_APP_STREAM_TICKET_MINT_ENABLED=0
ARG REACT_APP_PROOF_ACCESS_TOKEN_ENABLED=1
ARG REACT_APP_DEVICE_PROOF_REQUIRED=1
ENV REACT_APP_STREAM_TICKET_MINT_ENABLED=$REACT_APP_STREAM_TICKET_MINT_ENABLED
ENV REACT_APP_PROOF_ACCESS_TOKEN_ENABLED=$REACT_APP_PROOF_ACCESS_TOKEN_ENABLED
ENV REACT_APP_DEVICE_PROOF_REQUIRED=$REACT_APP_DEVICE_PROOF_REQUIRED

# Build for production
ENV NODE_ENV=production
ENV GENERATE_SOURCEMAP=false
ENV CI=true

RUN npm run build

# =============================================================================
# Stage 2: Production Nginx server
# =============================================================================
FROM nginx:1.27-alpine AS production

# Install security updates and wget for healthcheck
RUN apk update && apk upgrade --no-cache && \
  apk add --no-cache wget && \
  rm -rf /var/cache/apk/*

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Runtime config generator (runs on container startup)
RUN mkdir -p /docker-entrypoint.d && \
  printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  '' \
  'js_escape() {' \
  '  printf %s "$1" | sed -e "s/\\\\/\\\\\\\\/g" -e "s/\"/\\\\\"/g"' \
  '}' \
  '' \
  'BOT_USERNAME="${EARFLOW_TELEGRAM_BOT_USERNAME:-${REACT_APP_TELEGRAM_BOT_USERNAME:-}}"' \
  'BOT_USERNAME_ESC="$(js_escape "$BOT_USERNAME")"' \
  '' \
  'API_BASE_URL="${EARFLOW_API_BASE_URL:-${REACT_APP_API_URL:-}}"' \
  'API_BASE_URL_ESC="$(js_escape "$API_BASE_URL")"' \
  '' \
  'STREAMING_BASE_URL="${EARFLOW_STREAMING_BASE_URL:-${REACT_APP_STREAMING_API_URL:-}}"' \
  'STREAMING_BASE_URL_ESC="$(js_escape "$STREAMING_BASE_URL")"' \
  '' \
  'ENABLE_DIRECT_STREAM="${EARFLOW_ENABLE_DIRECT_STREAM:-${REACT_APP_ENABLE_DIRECT_STREAM:-}}"' \
  'ENABLE_DIRECT_STREAM_ESC="$(js_escape "$ENABLE_DIRECT_STREAM")"' \
  '' \
  'DEVICE_SYNC_ENABLED="${EARFLOW_DEVICE_SYNC_ENABLED:-${REACT_APP_DEVICE_SYNC_ENABLED:-false}}"' \
  'DEVICE_SYNC_ENABLED_ESC="$(js_escape "$DEVICE_SYNC_ENABLED")"' \
  '' \
  'cat > /tmp/runtime-config.js <<EOF' \
  'window.__EARFLOW_RUNTIME_CONFIG__ = Object.freeze({' \
  '  telegramBotUsername: "${BOT_USERNAME_ESC}",' \
  '  apiBaseUrl: "${API_BASE_URL_ESC}",' \
  '  streamingBaseUrl: "${STREAMING_BASE_URL_ESC}",' \
  '  enableDirectStream: "${ENABLE_DIRECT_STREAM_ESC}",' \
  '  deviceSyncEnabled: "${DEVICE_SYNC_ENABLED_ESC}"' \
  '});' \
  'EOF' \
  > /docker-entrypoint.d/40-runtime-config.sh && \
  chmod +x /docker-entrypoint.d/40-runtime-config.sh

# Copy built React app from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# Create non-root user and set permissions for read-only filesystem
# Nginx needs these directories for temp files
RUN addgroup -g 1001 -S nginx-app && \
  adduser -S -u 1001 -G nginx-app nginx-app && \
  # HTML content
  chown -R nginx-app:nginx-app /usr/share/nginx/html && \
  # Cache directories (will be tmpfs in docker-compose)
  mkdir -p /var/cache/nginx/client_temp && \
  mkdir -p /var/cache/nginx/proxy_temp && \
  mkdir -p /var/cache/nginx/fastcgi_temp && \
  mkdir -p /var/cache/nginx/uwsgi_temp && \
  mkdir -p /var/cache/nginx/scgi_temp && \
  chown -R nginx-app:nginx-app /var/cache/nginx && \
  # Log directory (will be tmpfs in docker-compose)
  chown -R nginx-app:nginx-app /var/log/nginx && \
  # PID file (will be in /var/run tmpfs)
  mkdir -p /var/run/nginx && \
  chown -R nginx-app:nginx-app /var/run && \
  # Remove user directive from main nginx.conf for non-root
  sed -i 's/^user /#user /' /etc/nginx/nginx.conf && \
  # Change pid path to writable location
  sed -i 's|/var/run/nginx.pid|/var/run/nginx/nginx.pid|' /etc/nginx/nginx.conf

# Switch to non-root user
USER nginx-app

EXPOSE 3004

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3004/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
