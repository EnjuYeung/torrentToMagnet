FROM node:26.8.1-alpine3.23@sha256:871eb674ad6e692c91330a8959f1ce2f80ba3f445cdc54e306869d2ea265e42d AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src

RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.4-alpine3.24-slim@sha256:a724e9ad0557e2c6f863573f82a6f86e18d91e420f1efbb12c45f574e48513d2 AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

USER 101:101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
