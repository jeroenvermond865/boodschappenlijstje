# Stap 1: bouw de website (Expo web-export)
FROM node:22-bookworm-slim AS web
WORKDIR /build/frontend
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000
COPY frontend/ ./
# Leeg = de app praat met de server op hetzelfde adres
ENV EXPO_PUBLIC_BACKEND_URL=""
ENV EXPO_PUBLIC_GOOGLE_LOGIN="1"
RUN npx expo export --platform web --output-dir /build/web

# Stap 2: de server (FastAPI) die de API en de website serveert
FROM python:3.11-slim
WORKDIR /srv
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /build/web ./web
ENV PORT=10000
EXPOSE 10000
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
