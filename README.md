# CoMatch

Event-Networking über angeleitete Mini-Spiele. Ein Admin stellt einen QR-Code
bereit, Teilnehmer scannen ihn und landen auf der Event-Seite. Der Admin aktiviert
dort ein Spiel — immer nur eines gleichzeitig.

**Find me**, das erste Spiel: Jeder macht ein Selfie. Alle 10 Sekunden verbindet der
Server wartende Teilnehmer paarweise. Man sieht nur das Foto seines Partners und muss
diese Person im Raum finden. Sind beide beieinander, halten sie ihre Handys
aneinander — beide Beschleunigungssensoren erkennen den Stoß, der Server korreliert
die Zeitstempel und zählt den Match.

## Aufbau

```
apps/
  web/      Teilnehmer-PWA        Vite + React + TypeScript
  admin/    Admin-App             Vite + React + TypeScript
  server/   API + Realtime        Fastify + Socket.io + Drizzle + Postgres
packages/
  core/     Geteilte Domänenlogik reines TypeScript, ohne Plattform-APIs
```

`packages/core` ist der Grund, warum später eine iOS-App entstehen kann, ohne alles
neu zu schreiben: Zustandsautomat, Socket-Vertrag, API-Client, Uhrenabgleich und die
Bump-Erkennung liegen dort als reines TypeScript. Für Expo wird nur der Sensor-Adapter
getauscht (`useDeviceMotion` → `expo-sensors`), die Logik wandert unverändert mit.
Eine ESLint-Regel verbietet in diesem Paket `window`, `document`, `navigator` und
Node-Builtins, damit die Zusage auch hält.

## Loslegen

```bash
cp .env.example .env
npm install
npm run db:up          # Postgres in Docker, Port 5433
npm run db:migrate
npm run db:seed        # legt den ersten Admin aus .env an
npm run dev            # core (watch), server :4000, web :5173, admin :5174
```

| Was | Wo |
| --- | --- |
| Teilnehmer-App | http://localhost:5173 |
| Admin-App | http://localhost:5174 |
| API | http://localhost:4000 |

## Auf echten Geräten testen

Kamera und Beschleunigungssensor brauchen **HTTPS** — über `http://<lan-ip>:5173`
verweigert iOS beides. Ausserdem verlangt iOS ab Version 13 die Sensor-Erlaubnis aus
einer echten Nutzergeste heraus; im Onboarding hängt sie deshalb an einem eigenen Tap.

```bash
brew install mkcert && mkcert -install
mkcert -cert-file certs/dev.pem -key-file certs/dev-key.pem localhost 192.168.x.x
npm run dev
```

Für die Bump-Erkennung braucht es zwei echte Geräte. Um allein am Rechner nur den
Serverpfad zu prüfen, hängt `?simulateBump=1` an die Spiel-URL — das blendet einen
Knopf ein, der einen synthetischen Stoß auslöst.

Als Gegenüber dafür gibt es einen Teilnehmer ohne Handy:

```bash
node apps/server/scripts/fake-participant.mjs <sessionToken> --bump
```

Er verbindet sich wie die echte App, lässt sich paaren und meldet im Sekundentakt
einen Stoß — damit kommt jeder Stoß aus dem Browser sicher ins Zeitfenster. Was
der Server einem Teilnehmer über seinen Zustand mitteilt, zeigt
`node apps/server/scripts/inspect-state.mjs <sessionToken>`.

Beides ersetzt die Abnahme mit zwei echten Geräten nicht: Ob die Bump-Erkennung im
Raum trägt, zeigt sich nur dort.

## Befehle

| Befehl | Wirkung |
| --- | --- |
| `npm run dev` | Alle vier Pakete parallel im Watch-Modus |
| `npm run build` | Produktions-Build aller Pakete |
| `npm test` | Unit- und Integrationstests |
| `npm run typecheck` | TypeScript über alle Pakete |
| `npm run lint` | ESLint |
| `npm run db:generate` | Migration aus dem Drizzle-Schema erzeugen |
| `npm run db:migrate` | Migrationen anwenden |

## Deployment (Railway)

Drei Dienste in einem Projekt, jeder mit eigenem Dockerfile im Repo-Wurzelverzeichnis
gebaut:

| Dienst | Dockerfile | Wichtig |
| --- | --- | --- |
| `server` | `Dockerfile` | `railway.json` setzt Healthcheck und Startbefehl |
| `web` | `apps/web/Dockerfile` | `VITE_API_URL` als **Build-Argument** |
| `admin` | `apps/admin/Dockerfile` | `VITE_API_URL` als **Build-Argument** |

Dazu ein Postgres-Plugin und ein Bucket für die Fotos. Region **EU-West (Amsterdam)**
wegen der Personenfotos.

```bash
railway up            # baut und deployt den aktuellen Stand
```

Zwei Dinge, an denen es sonst still schiefgeht:

- **`numReplicas` muss 1 bleiben.** Der 10-Sekunden-Takt und die Präsenzverwaltung
  laufen im Serverprozess. Bei zwei Instanzen tickte jede für sich. Der Matcher hält
  zwar bereits einen Advisory Lock in Postgres dagegen, aber die Präsenz liegt im
  Arbeitsspeicher — die zweite Instanz kennt die Teilnehmer der ersten nicht.
  Für echtes Hochskalieren müsste die Präsenz nach Redis wandern.
- **`VITE_API_URL` ist ein Build-Argument, keine Laufzeitvariable.** Vite ersetzt
  `import.meta.env` beim Bündeln; nachträglich gesetzt bewirkt sie nichts.

Nötige Variablen am Server-Dienst: `DATABASE_URL` (aus dem Postgres-Plugin),
`SESSION_SECRET`, `PUBLIC_WEB_URL`, `CORS_ORIGINS`, `STORAGE_DRIVER=s3` samt
`S3_*`-Zugangsdaten, `DATA_RETENTION_HOURS`. Die Migrationen laufen im Startbefehl
vor dem Serverstart.

## Datenschutz

Auf einem Event entstehen Personenfotos — der sensibelste Teil der App:

- Vor dem Selfie steht ein Hinweis, wofür es verwendet wird und wie lange es bleibt.
- Fotos liegen unter nicht erratbaren Keys und werden über kurzlebige Presigned URLs
  ausgeliefert; es gibt keine dauerhaft öffentliche Bild-URL.
- Ein Job löscht Fotos und Klarnamen `DATA_RETENTION_HOURS` nach Event-Ende. Die
  aggregierten Zahlen für die Auswertung bleiben.
- Teilnehmer können ihre Daten jederzeit selbst löschen.
- Produktion läuft in der EU-Region, keine Drittanbieter-Analytics.
