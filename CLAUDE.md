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

- **Code-Kommentare und Commit-Messages auf Deutsch**, ebenso Eventliste, Login und
  Kopfzeile der Admin-App. Kommentare erklären das Warum, nicht das Was — den
  bestehenden Stil beibehalten.
- **Teilnehmer-App und die ganze Eventseite der Admin-App gibt es auf Deutsch und
  Englisch** — ihre Texte stehen nie direkt im Code: Teilnehmer-App in
  `packages/core/src/i18n/messages/{de,en}.ts`, Eventseite (Steuerung, Leinwand,
  QR-Lightbox) in `apps/admin/src/eventTexts.ts`. Die deutsche Fassung ist die
  Vorlage; fehlt ein Schlüssel im Englischen, scheitert der Typecheck. Fehler zeigen
  die Clients über den `code` des Servers an, nie über seine (deutsche) `message` —
  ein neuer Fehlercode gehört in beide Wörterbücher, die ihn anzeigen.
- **Enum-Werte kommen aus `@comatch/core`** und speisen die pg-Enums in
  `apps/server/src/db/schema.ts` — ein neuer Zustand im Core erzwingt eine
  Migration.
- Invarianten liegen bevorzugt als Constraint in der Datenbank, nicht als
  App-Prüfung (Beispiel: partieller Unique-Index `games_one_active_per_event`).
- Admin-Routen schützen sich selbst: jeder Handler ruft `await
  requireAdmin(request)` auf — es gibt keinen globalen Hook.
- **Personendaten werden nie gelöscht, sondern anonymisiert** — und zwar immer
  über `eraseParticipants` in `apps/server/src/lib/erase.ts` (Selbstlöschung,
  Entfernen durch den Admin, Aufräumjob). Ein echtes DELETE nähme per Kaskade die
  Paare mit und verfälschte die Auswertung. `deletedAt` sperrt zugleich die Session.
- Die Löschfrist (`DATA_RETENTION_HOURS`) läuft ab Enddatum **oder** Archivierung;
  Events ohne beides räumt `jobs/retention.ts` nach 72 h ohne Aktivität auf.
  `purgedAt` ist keine Sperre: Wer danach beitritt, wird beim nächsten Lauf erneut
  bereinigt.
- **Eventdesign: gespeichert werden nur die Eingaben** (`events.design`: Hintergrund,
  Akzent, Schrift, Ecken), nie abgeleitete Farben. Alle Tokens rechnet `deriveTheme`
  in `packages/core/src/theme/` — samt Kontrast-Leitplanken, die eine unlesbare
  Eingabe still korrigieren statt sie abzulehnen. Eine neue Farbe in einer Oberfläche
  heißt deshalb: CSS-Variable in `styles.css` **und** Token in `deriveTheme` (mit
  Zusage im Property-Test `derive.test.ts`), nie ein fester Hex-Wert in einer Regel.
  Ausnahmen mit Absicht: der QR-Code (immer dunkel auf Weiß) und die Logo-Plakette.
- Design-Vorlagen (`design_templates`) werden beim Anwenden ins Event **kopiert**,
  nicht referenziert — eine geänderte Vorlage färbt kein laufendes Event um.
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
  `.page--screen` in `styles.css`, die Steuerung bleibt davon unberührt. Die ganze
  Eventseite holt ihre Texte über `eventTexts(event.locale)`; solange das Event noch
  lädt, gilt `pendingEventTexts(true)` (Browsersprache, sonst Englisch).
- **Das Eventdesign gilt auf den Handys und auf der Leinwand, nie in der Steuerung.**
  Teilnehmer-App: `EventShell.tsx` holt es je Event, `theme/applyDesign.ts` setzt die
  CSS-Variablen am `<html>` und merkt sie je Slug im `localStorage` (kein Aufblitzen
  des Standarddesigns); live kommt es über `event:changed` und die Socket-Begrüßung.
  Admin-App: `useScreenDesign` (`apps/admin/src/theme.tsx`) greift nur mit `?leinwand`,
  die Vorschau im Editor (`pages/EventDesign.tsx`) über gescopte Variablen.
- Das **Logo ist öffentlich** und hat — anders als Fotos — eine dauerhafte Adresse
  (`/api/events/:slug/logo?v=…`, immutable gecacht); ein neuer Upload bekommt einen
  neuen Schlüssel und damit eine neue URL. SVG-Uploads werden gerastert, nie ausgeliefert.
- **Welche Sprache jemand sieht**: Browsersprache vor Eventsprache
  (`resolveLocale` in `packages/core/src/i18n/locale.ts`), ohne Event Englisch.
  Im eigenen Browser sieht man die Eventsprache nur mit `?lang=fr` an der
  Teilnehmer-URL. Eine neue Sprache heißt: `LOCALES` erweitern → Migration → beide
  Wörterbücher ergänzen.
- Nachrichten an Teilnehmer nie aus einer Transaktion heraus senden — erst
  committen, dann `flush()` (siehe `Notification`-Muster in
  `apps/server/src/game/engine.ts`).
