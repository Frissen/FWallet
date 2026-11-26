# syntax=docker/dockerfile:1

# ── Stage 1: build the Vite frontend ──────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /fe

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./

# Public (non-secret) build-time settings for the Mini App. Set them as env
# vars / build args on your host; Vite inlines them into the bundle.
ARG VITE_BOT_USERNAME
ARG VITE_MINIAPP_SHORTNAME
ARG VITE_APP_BASE_URL
ARG VITE_P2P_API_BASE
ARG VITE_TONCENTER_API_KEY
ARG VITE_CHANGENOW_API_KEY
ENV VITE_BOT_USERNAME=$VITE_BOT_USERNAME \
    VITE_MINIAPP_SHORTNAME=$VITE_MINIAPP_SHORTNAME \
    VITE_APP_BASE_URL=$VITE_APP_BASE_URL \
    VITE_P2P_API_BASE=$VITE_P2P_API_BASE \
    VITE_TONCENTER_API_KEY=$VITE_TONCENTER_API_KEY \
    VITE_CHANGENOW_API_KEY=$VITE_CHANGENOW_API_KEY

RUN npm run build

# ── Stage 2: python runtime that serves the bot + static frontend ────────
FROM python:3.11-slim
WORKDIR /app

# DejaVu fonts are needed by Pillow when rendering the price card.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Copy the built Mini App from the frontend stage. FastAPI mounts this as
# static at /app (see app/main.py).
COPY --from=frontend /fe/dist ./static_frontend

ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
