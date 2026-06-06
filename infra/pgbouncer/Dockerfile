FROM alpine:3.20

RUN apk add --no-cache pgbouncer postgresql-client \
    && addgroup -S pgbouncer-run \
    && adduser -S -D -H -h /var/lib/pgbouncer -s /sbin/nologin -G pgbouncer-run pgbouncer-run \
    && mkdir -p /etc/pgbouncer /var/lib/pgbouncer /var/run/pgbouncer \
    && chown -R pgbouncer-run:pgbouncer-run /etc/pgbouncer /var/lib/pgbouncer /var/run/pgbouncer

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 6432

USER pgbouncer-run
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["pgbouncer", "/etc/pgbouncer/pgbouncer.ini"]
