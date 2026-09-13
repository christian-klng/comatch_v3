# CLAUDE.md

Arbeitsnotizen für Claude Code. Was das Produkt tut und wie das Deployment
funktioniert, steht in der [README](README.md) — hier steht nur, was beim
Arbeiten am Code Zeit spart.

## Aufbau

npm-Workspaces-Monorepo, durchgehend ESM + TypeScript:

- `packages/core` — geteilte Domänentypen, Socket-Vertrag, typisierter API-Client.
  **Plattformfrei**: eine ESLint-Regel verbietet `window`, `document`, `navigator`
  und Node-Builtins (das Paket soll unverändert in eine spätere Expo-App wandern).
- `apps/server` — Fastify 5 + Socket.io + Drizzle ORM + Postgres + zod. Port 4000.
- `apps/web` — Teilnehmer-PWA (Vite + React 19). Port 5173.
- `apps/admin` — Admin-App (Vite + React 19 + react-router-dom). Port 5174.
  Kein Komponenten-Framework, kein Modal-Pattern — Bestätigungen sind zweistufige
  Inline-Buttons, Styling liegt komplett in `apps/admin/src/styles.css`.

Typänderungen beginnen fast immer in `packages/core` (Typen in `types.ts`,
Client-Methoden in `api.ts`); Server und Frontends konsumieren sie von dort.

## Konventionen

- **Code-Kommentare, Commit-Messages und die Admin-Steuerung auf Deutsch.**
  Kommentare erklären das Warum, nicht das Was — den bestehenden Stil beibehalten.
- **Was Teilnehmende oder der Saal lesen, gibt es auf Deutsch und Englisch** — und
  es steht nie direkt im Code: Teilnehmer-App in
  `packages/core/src/i18n/messages/{de,en}.ts`, Leinwand und Projektionsfenster in
  `apps/admin/src/screenTexts.ts`. Die deutsche Fassung ist die Vorlage; fehlt ein
  Schlüssel im Englischen, scheitert der Typecheck. Fehler zeigen die Clients über
  den `code` des Servers an, nie über seine (deutsche) `message`.
- **Enum-Werte kommen aus `@comatch/core`** und speisen die pg-Enums in
  `apps/server/src/db/schema.ts` — ein neuer Zustand im Core erzwingt eine
  Migration.
- Invarianten liegen bevorzugt als Constraint in der Datenbank, nicht als
  App-Prüfung (Beispiel: partieller Unique-Index `games_one_active_per_event`).
- Admin-Routen schützen sich selbst: jeder Handler ruft `await
  requireAdmin(request)` auf — es gibt keinen globalen Hook.
- Der Event-Slug steckt in gedruckten/projizierten QR-Codes und darf sich nach
  der Anlage **nie** ändern (auch nicht beim Umbenennen).

## Entwicklung & Tests

```bash
npm run db:up        # Postgres in Docker, Port 5433 (Container comatch-db)
npm run db:migrate   # nach jedem Schema-Change nötig — auch vor den Tests
npm run dev          # core (watch), server :4000, web :5173, admin :5174
```

- **Schema ändern**: `schema.ts` anpassen → `npm run db:generate` →
  `npm run db:migrate`. Die Integrationstests laufen gegen dieselbe lokale DB;
  ohne angewandte Migration schlagen sie mit 500ern fehl.
- `npm test`, `npm run typecheck`, `npm run lint` laufen über alle Workspaces.
  Die Server-Tests (`vitest`) brauchen das laufende Postgres.
- Admin-Login lokal: `ADMIN_EMAIL`/`ADMIN_PASSWORD` aus der Root-`.env`
  (`npm run db:seed` legt den Admin an). Das Token liegt im `sessionStorage`
  unter `comatch.admin.token`.
- `.claude/launch.json` startet den Dev-Stack mit erzwungenem `PORT=4000`:
  Das Browser-Preview injiziert sonst seinen eigenen `PORT`, den der API-Server
  übernimmt — und kollidiert dann mit Vite.

## Architektur-Fallstricke

- **Eine Server-Instanz, nicht mehr.** Spieltakt, Präsenz und der Countdown vor
  einem Spielstart leben im Arbeitsspeicher des Serverprozesses (`numReplicas: 1`
  auf Railway).
- Teilnehmer und ihre Zustände sind **event-gebunden**, Paare (`pairs`) tragen
  `gameId` **und** `eventId` (denormalisiert für den Matcher-Hotpath).
  Spiellauf-Statistiken filtern über `gameId`, Teilnehmerzahlen über `eventId`.
- Die Admin-App **pollt** alle 3 s (während eines Countdowns jede Sekunde) — es
  gibt keinen Admin-Websocket. Das Poll-Merge in `EventDetail.tsx` überschreibt
  bewusst nicht `joinUrl`, sonst flackert der projizierte QR-Code. Ein neues
  Live-Feld in `AdminEventDetail` muss dort eingetragen werden, sonst aktualisiert
  es sich nur beim Neuladen.
- Die Eventseite ist die Leinwand: Der **Leinwand-Modus** hängt am URL-Parameter
  `?leinwand` (`apps/admin/src/screen.ts`). Neue Bedienelemente auf der Seite
  gehören hinter `!screen`, sonst landen sie auf dem Beamer. Die Leinwand hat
  ihr eigenes Raster (`.grid-screen`) und größere Schriften — alles unter
  `.page--screen` in `styles.css`, die Steuerung bleibt davon unberührt. Was im Leinwand-Modus
  sichtbar bleibt, holt seine Texte über `screenTexts(event.locale, screen)`.
- **Welche Sprache jemand sieht**: Browsersprache vor Eventsprache
  (`resolveLocale` in `packages/core/src/i18n/locale.ts`), ohne Event Englisch.
  Im eigenen Browser sieht man die Eventsprache nur mit `?lang=fr` an der
  Teilnehmer-URL. Eine neue Sprache heißt: `LOCALES` erweitern → Migration → beide
  Wörterbücher ergänzen.
- Nachrichten an Teilnehmer nie aus einer Transaktion heraus senden — erst
  committen, dann `flush()` (siehe `Notification`-Muster in
  `apps/server/src/game/engine.ts`).
