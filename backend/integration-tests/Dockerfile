FROM oven/bun:1.3.5

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests

RUN bun install --no-progress

ENV IT_GATEWAY_BASE_URL=http://api-gateway:3000
ENV IT_ADAPTER_BASE_URL=http://ebap-hls-adapter:3095
ENV IT_PARTY_BASE_URL=http://party-state-service:3130
ENV IT_PARTY_GATEWAY_URL=http://party-gateway-service:3131
ENV IT_ORIGIN=https://earflow.ru

CMD ["bun", "test"]
