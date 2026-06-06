FROM node:22-alpine

RUN apk add --no-cache ffmpeg opus-tools flac

WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY src/ ./src/

USER node

CMD ["node", "src/worker.js"]
