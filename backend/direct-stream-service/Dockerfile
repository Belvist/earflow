FROM oven/bun:1.3.5

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --no-progress

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3096

EXPOSE 3096

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3096') + '/health').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "src/main.ts"]
