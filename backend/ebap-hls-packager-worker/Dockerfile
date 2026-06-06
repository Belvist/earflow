FROM oven/bun:1.3.5

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock* ./
RUN if [ -f bun.lock ] || [ -f bun.lockb ]; then bun install --production --frozen-lockfile --no-progress; else bun install --production --no-progress; fi

COPY src ./src
COPY tsconfig.json ./

ENV NODE_ENV=production

CMD ["bun", "src/main.ts"]
