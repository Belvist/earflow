# =============================================================================
# NGINX LOAD BALANCER - HARDENED DOCKERFILE
# =============================================================================
# Security-focused build with minimal attack surface
# Based on nginx:alpine-slim (minimal CVEs)
# =============================================================================

# Use the slimmest official nginx image - significantly fewer vulnerabilities
FROM nginx:1.27-alpine-slim

# Labels for identification and tracking
LABEL maintainer="music-platform"
LABEL description="Hardened Nginx Load Balancer"
LABEL version="1.0"
LABEL security.hardened="true"

# =============================================================================
# SECURITY HARDENING
# =============================================================================
RUN set -eux; \
    # =========================================================================
    # 1. Update base packages to latest security patches
    # =========================================================================
    apk update && apk upgrade --no-cache; \
    \
    # =========================================================================
    # 2. Install only required packages
    # =========================================================================
    apk add --no-cache \
    # wget for healthcheck (smaller than curl)
    wget \
    # tzdata for proper timezone handling
    tzdata; \
    \
    # =========================================================================
    # 3. Remove unnecessary packages (reduce attack surface)
    # =========================================================================
    apk del --purge \
    curl \
    2>/dev/null || true; \
    \
    # =========================================================================
    # 4. Clean up
    # =========================================================================
    rm -rf /var/cache/apk/* /tmp/* /root/.cache; \
    \
    # =========================================================================
    # 5. Remove default configs and static files
    # =========================================================================
    rm -rf /etc/nginx/conf.d/default.conf; \
    rm -rf /usr/share/nginx/html/*; \
    \
    # =========================================================================
    # 6. Create required directories
    # =========================================================================
    mkdir -p \
    /var/cache/nginx/client_temp \
    /var/cache/nginx/proxy_temp \
    /var/cache/nginx/ebap_cache \
    /var/cache/nginx/audio_cache \
    /var/cache/nginx/fastcgi_temp \
    /var/cache/nginx/uwsgi_temp \
    /var/cache/nginx/scgi_temp \
    /var/log/nginx \
    /var/run/nginx; \
    \
    # =========================================================================
    # 7. Set proper permissions
    # =========================================================================
    chown -R nginx:nginx \
    /var/cache/nginx \
    /var/log/nginx \
    /var/run/nginx \
    /etc/nginx; \
    chmod -R 755 /var/cache/nginx /var/log/nginx; \
    \
    # =========================================================================
    # 8. Create pid file with proper permissions
    # =========================================================================
    touch /var/run/nginx/nginx.pid; \
    chown nginx:nginx /var/run/nginx/nginx.pid; \
    \
    # =========================================================================
    # 9. Harden file permissions
    # =========================================================================
    chmod 700 /var/log/nginx; \
    \
    # =========================================================================
    # 10. Remove unnecessary SUID/SGID binaries (security)
    # =========================================================================
    find / -perm /6000 -type f -exec chmod a-s {} \; 2>/dev/null || true

# =============================================================================
# CREATE ERROR PAGES (JSON format for API)
# =============================================================================
RUN mkdir -p /usr/share/nginx/html && \
    echo '{"error":"Not Found","message":"The requested resource was not found"}' \
    > /usr/share/nginx/html/404.json && \
    echo '{"error":"Internal Server Error","message":"Service temporarily unavailable"}' \
    > /usr/share/nginx/html/50x.json && \
    chown -R nginx:nginx /usr/share/nginx/html

# =============================================================================
# COPY CONFIGURATION
# =============================================================================
COPY --chown=root:root nginx.conf /etc/nginx/nginx.conf
COPY --chown=root:root conf.d/ /etc/nginx/conf.d/
COPY --chown=root:root include-maintenance.conf /etc/nginx/include-maintenance.conf
COPY --chown=root:root include/pop-proxy-headers.conf /etc/nginx/include/pop-proxy-headers.conf
COPY --chown=nginx:nginx html/maintenance.html /usr/share/nginx/html/maintenance.html
RUN chmod 644 /etc/nginx/nginx.conf /etc/nginx/include-maintenance.conf /etc/nginx/conf.d/*.conf

# =============================================================================
# UPDATE PID PATH IN CONFIG (for running as non-root later if needed)
# =============================================================================
RUN sed -i 's|/var/run/nginx.pid|/var/run/nginx/nginx.pid|g' /etc/nginx/nginx.conf 2>/dev/null || true

# =============================================================================
# HEALTH CHECK
# =============================================================================
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost/nginx-health || exit 1

# =============================================================================
# EXPOSE PORT
# =============================================================================
EXPOSE 80

# =============================================================================
# SIGNAL HANDLING
# =============================================================================
STOPSIGNAL SIGQUIT

# =============================================================================
# START NGINX
# Note: Running as root to bind to port 80, but nginx workers run as 'nginx' user
# This is the standard nginx security model
# =============================================================================
CMD ["nginx", "-g", "daemon off;"]
