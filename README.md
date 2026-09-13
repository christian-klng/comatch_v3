# Comatch

Event-Networking über angeleitete Mini-Spiele. Ein Admin stellt einen QR-Code
bereit, Teilnehmer scannen ihn und landen auf der Event-Seite. Der Admin aktiviert
dort ein Spiel — immer nur eines gleichzeitig; nach dem Ende eines Spiels kann das
nächste starten, und jeder Lauf zählt seine eigenen Kennzahlen.

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

Läuft unter dem Projekt `comatch` in der Region **Amsterdam** — auf einem Event
entstehen Fotos von Gesichtern, und die sollen die EU nicht verlassen.

| Dienst | Adresse | Gebaut aus |
| --- | --- | --- |
| Teilnehmer-App | https://comatch.up.railway.app | `apps/web/Dockerfile` |
| Admin-App | https://admin-production-b113.up.railway.app | `apps/admin/Dockerfile` |
| API | https://server-production-7b60.up.railway.app | `Dockerfile` |

Dazu ein Postgres-Dienst und der Bucket `photos` für die Fotos.

```bash
railway config plan                 # Änderungen an der Infrastruktur ansehen
railway config apply                # anwenden
railway up --service server         # Code ausrollen (je Dienst einzeln)
```

### Was die Infrastruktur beschreibt

`.railway/railway.ts` — TypeScript statt `railway.json`, weil dort das ganze Projekt
hineinpasst: Dienste, Datenbank, Bucket, Variablen. Ein Dienst darf **nicht** aus
beiden Modellen verwaltet werden, deshalb gibt es kein `railway.json` mehr.

Die Datei hängt über `.railway/tsconfig.json` im `npm run typecheck`. Das ist kein
Selbstzweck: `railway config plan` übergeht unbekannte Felder stillschweigend. Ein
`dockerfilePath` an der falschen Stelle erzeugt dann keinen Fehler, sondern einfach
keine Wirkung — und man merkt es erst, wenn der Dienst das falsche Image baut.

### Fallstricke, die hier schon zugeschlagen haben

- **Die Beschreibung ist über das ganze Projekt deklarativ.** Was nicht in
  `.railway/railway.ts` steht, löscht `railway config apply` — beim ersten Versuch
  hätte das den Foto-Bucket samt Inhalt mitgenommen. Der Plan zeigt solche Änderungen
  als „destructive"; ihn zu lesen ist Pflicht, nicht Kür.
- **`numReplicas` muss 1 bleiben.** Der 10-Sekunden-Takt und die Präsenzverwaltung
  laufen im Serverprozess. Der Matcher hält zwar einen Advisory Lock in Postgres
  dagegen, aber die Präsenz liegt im Arbeitsspeicher — eine zweite Instanz kennt die
  Teilnehmer der ersten nicht. Für echtes Hochskalieren müsste sie nach Redis wandern.
- **`VITE_API_URL` ist ein Bau-Argument, keine Laufzeitvariable.** Vite ersetzt
  `import.meta.env` beim Bündeln; nachträglich gesetzt bewirkt sie nichts.
- **`.dockerignore` gilt für alle drei Images.** Ein Ausschluss von `apps/web`
  entzieht dem Web-Image seinen eigenen Quellcode — der Build scheitert dann an einer
  fehlenden `nginx.conf`, was zunächst nach einem Tippfehler aussieht.
- **nginx darf nicht fest auf Port 80 lauschen.** Railway routet auf den Port aus
  `PORT`; sonst antworten die Frontends mit 502, obwohl nginx sauber läuft. Deshalb
  sind die Konfigurationen Vorlagen mit `listen ${PORT}` — und
  `NGINX_ENVSUBST_FILTER=PORT` ist dabei nicht optional, sonst leert envsubst auch
  nginx-eigene Variablen wie `$uri`.
- **Railway-Buckets sprechen Virtual-Host-Stil.** `S3_FORCE_PATH_STYLE` gehört auf
  `false`; mit Pfad-Stil scheitert jeder Foto-Upload mit einer wenig aussagekräftigen
  Meldung.

Migration und Anlage des ersten Admins laufen im Startbefehl des Server-Images, nicht
in der Plattformkonfiguration — so bringt das Image alles mit und verhält sich überall
gleich. Beide Schritte sind gefahrlos wiederholbar; das Seed-Skript rührt einen
vorhandenen Admin nicht an, damit ein Deploy kein geändertes Passwort zurücksetzt.
Zum absichtlichen Zurücksetzen: `npm run db:seed -- --force`.

## Sprachen

Teilnehmer-App und Leinwand gibt es auf Deutsch und Englisch; die Admin-Steuerung
bleibt deutsch. Wer Deutsch oder Englisch im Browser eingestellt hat, sieht diese
Sprache — in der Reihenfolge, die der Browser nennt. Die Sprache, die der Admin auf
der Eventseite wählt, gilt für die Leinwand und für alle, deren Browser keine der
beiden nennt. Die Startseite gehört zu keinem Event und fällt auf Englisch zurück.

Stellt der Admin um, wechseln verbundene Handys sofort, ohne Neuladen. Um die
Eventsprache im eigenen Browser zu sehen, hängt `?lang=fr` an die Teilnehmer-URL —
das ersetzt die Browsersprachen für diesen Tab.

## Datenschutz

Auf einem Event entstehen Personenfotos — der sensibelste Teil der App:

- Vor dem Selfie steht ein Hinweis, wofür es verwendet wird und wie lange es bleibt.
- Fotos liegen unter nicht erratbaren Keys und werden über kurzlebige Presigned URLs
  ausgeliefert; es gibt keine dauerhaft öffentliche Bild-URL.
- Ein Job löscht Fotos und Klarnamen `DATA_RETENTION_HOURS` nach Event-Ende. Die
  aggregierten Zahlen für die Auswertung bleiben.
- Teilnehmer können ihre Daten jederzeit selbst löschen.
- Produktion läuft in der EU-Region, keine Drittanbieter-Analytics.
