# Admin-App als statische Auslieferung.
# Vom Repo-Wurzelverzeichnis bauen:  docker build -f apps/admin/Dockerfile .

FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/admin/package.json apps/admin/
RUN npm ci --workspace @comatch/core --workspace @comatch/admin --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/admin apps/admin

# Die API-Adresse wird zur Bauzeit eingebacken — Vite ersetzt import.meta.env
# beim Bündeln, zur Laufzeit lässt sich daran nichts mehr ändern.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build --workspace @comatch/core \
 && npm run build --workspace @comatch/admin

FROM nginx:alpine AS runtime
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
