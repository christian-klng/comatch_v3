import { bucket, defineRailway, postgres, preserve, project, service } from 'railway/iac'

/**
 * Die Railway-Infrastruktur von Comatch.
 *
 * Drei Dienste aus einem Repository, jeder mit eigenem Dockerfile. Alles läuft in
 * Europa: Auf einem Event entstehen Fotos von Gesichtern, und die sollen die EU
 * nicht verlassen.
 *
 * Nicht hier drin: Geheimnisse (SESSION_SECRET, Admin-Zugang, Bucket-Zugangsdaten)
 * und die von Railway erzeugten Domains. Beides wird nach dem Anwenden über die CLI
 * gesetzt und hier nur mit `preserve()` bewahrt, damit ein späteres Anwenden es
 * nicht wieder wegräumt.
 *
 * Der Foto-Bucket wird ebenfalls per CLI angelegt: Der Bucket-Helfer der DSL gibt
 * seine Zugangsdaten nicht als Referenzen heraus.
 */
export default defineRailway(() => {
  // Name in Großschreibung, weil `railway add --database postgres` den Dienst so
  // angelegt hat. Ein abweichender Name hier würde ihn löschen und neu anlegen.
  const db = postgres('Postgres')

  /*
   * Der Foto-Bucket, in Amsterdam wie die Dienste.
   *
   * Er muss hier stehen, obwohl seine Zugangsdaten per CLI gesetzt werden: Diese
   * Beschreibung ist über das ganze Projekt deklarativ, und was hier fehlt, würde
   * beim nächsten Anwenden gelöscht — samt aller Fotos darin.
   */
  const photos = bucket('photos', { region: 'ams' })

  const server = service('server', {
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    healthcheckPath: '/health/ready',

    /*
     * Genau eine Instanz. Der 10-Sekunden-Takt und die Präsenzverwaltung laufen im
     * Serverprozess; bei zwei Instanzen tickte jede für sich und keine wüsste von
     * den Teilnehmern der anderen. Der Matcher hält zwar einen Advisory Lock in
     * Postgres dagegen, aber die Präsenz liegt im Arbeitsspeicher.
     */
    deploy: { multiRegionConfig: { 'europe-west4-drams3a': { numReplicas: 1 } } },

    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      DATABASE_URL: db.env.DATABASE_URL,

      // Fotos in den Objektspeicher statt auf die Festplatte des Containers —
      // die ist bei jedem Deploy weg.
      STORAGE_DRIVER: 's3',
      S3_REGION: 'auto',
      // Railway-Buckets sprechen Virtual-Host-Stil; Pfad-Stil bräuchte nur MinIO.
      S3_FORCE_PATH_STYLE: 'false',

      // Wie lange nach Event-Ende Fotos und Klarnamen bestehen bleiben.
      DATA_RETENTION_HOURS: '24',

      /*
       * Alles Folgende wird nach dem Anwenden über die CLI gesetzt und hier nur
       * bewahrt: Zugangsdaten des Buckets und Geheimnisse gehören nicht in die
       * Versionsverwaltung, und die von Railway erzeugten Domains ebenso wenig.
       */
      S3_ENDPOINT: preserve(),
      S3_BUCKET: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
      SESSION_SECRET: preserve(),
      ADMIN_EMAIL: preserve(),
      ADMIN_PASSWORD: preserve(),
      PUBLIC_WEB_URL: preserve(),
      CORS_ORIGINS: preserve(),
    },
  })

  const web = service('web', {
    build: { builder: 'DOCKERFILE', dockerfilePath: 'apps/web/Dockerfile' },
    deploy: { multiRegionConfig: { 'europe-west4-drams3a': { numReplicas: 1 } } },
    env: {
      // Vite backt die Adresse beim Bündeln ein; zur Laufzeit ist daran nichts
      // mehr zu ändern. Deshalb ist das ein Bau-Argument, keine Laufzeitvariable.
      VITE_API_URL: preserve(),
    },
  })

  const admin = service('admin', {
    build: { builder: 'DOCKERFILE', dockerfilePath: 'apps/admin/Dockerfile' },
    deploy: { multiRegionConfig: { 'europe-west4-drams3a': { numReplicas: 1 } } },
    env: {
      VITE_API_URL: preserve(),
    },
  })

  return project('comatch', {
    resources: [db, photos, server, web, admin],
  })
})
