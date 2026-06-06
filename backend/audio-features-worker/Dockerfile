FROM ghcr.io/mtg/essentia:latest

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN set -eux; \
    if command -v apt-get >/dev/null 2>&1; then \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3-pip ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    elif command -v apk >/dev/null 2>&1; then \
    apk add --no-cache py3-pip ca-certificates; \
    else \
    python3 -m ensurepip --upgrade; \
    fi; \
    python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel; \
    python3 -m pip install --no-cache-dir -r requirements.txt

COPY app ./app

CMD ["python3", "-m", "app.main"]
