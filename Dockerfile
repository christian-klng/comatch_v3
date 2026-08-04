# Server-Image für Railway.
#
# Debian-basiert und nicht Alpine: sharp lädt für glibc fertige Binärpakete, unter
# musl müsste libvips im Image gebaut werden — mehrere Minuten Bauzeit für nichts.

FROM node:22-slim AS build
WORKDIR /app

# Erst die Manifeste kopieren: Solange sich keine Abhängigkeit ändert, bleibt die
# Installationsschicht im Cache und der Build dauert Sekunden statt Minuten.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN npm ci --workspace @comatch/core --workspace @comatch/server --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/server apps/server

RUN npm run build --workspace @comatch/core \
 && npm run build --workspace @comatch/server

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Nur Produktionsabhängigkeiten. @comatch/core steckt bereits im Bundle von tsup.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev --workspace @comatch/server --include-workspace-root \
 && npm cache clean --force

COPY --from=build /app/apps/server/dist apps/server/dist
# Die Migrationen müssen mit ins Image: Der Startbefehl wendet sie vor dem Start an.
COPY --from=build /app/apps/server/drizzle apps/server/drizzle

# Nicht als root laufen.
USER node

EXPOSE 4000

# Migration und Admin-Anlage laufen im Startbefehl, nicht in der
# Plattformkonfiguration: So bringt das Image alles mit und verhält sich überall
# gleich — lokal, auf Railway, in einem anderen Container-Dienst. Beide Schritte
# sind gefahrlos wiederholbar; das Seed-Skript rührt einen vorhandenen Admin nicht an.
CMD ["sh", "-c", "node apps/server/dist/db/migrate.js && node apps/server/dist/db/seed.js && node apps/server/dist/index.js"]
