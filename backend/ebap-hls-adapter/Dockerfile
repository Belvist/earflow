FROM oven/bun:1.3.5

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock* ./
RUN if [ -f bun.lock ] || [ -f bun.lockb ]; then bun install --production --frozen-lockfile --no-progress; else bun install --production --no-progress; fi

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3095

EXPOSE 3095

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3095') + '/health').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "src/main.ts"]
