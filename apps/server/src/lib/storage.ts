import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../env.js'

/**
 * Ablage der Teilnehmerfotos.
 *
 * Beide Treiber geben ausschließlich **kurzlebige, signierte** URLs heraus. Ein
 * Foto darf nie unter einer dauerhaft gültigen Adresse erreichbar sein — auch nicht
 * in der Entwicklung, sonst weicht das Verhalten genau dort ab, wo es zählt.
 */
export interface PhotoStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  remove(keys: readonly string[]): Promise<void>
  signedUrl(key: string): Promise<string>
  /**
   * Nur für Inhalte, die der Server selbst öffentlich ausliefert — das Event-Logo.
   * Fotos gehen nie diesen Weg, sondern immer über {@link signedUrl}.
   */
  read(key: string): Promise<Buffer>
}

/** Gültigkeit einer Bild-URL. Lang genug für eine Suchrunde, kurz genug zum Teilen untauglich. */
export const SIGNED_URL_TTL_SECONDS = 15 * 60

/**
 * Signiert wird ab dem Beginn eines Fünf-Minuten-Fensters, nicht ab jetzt. So bleibt
 * die URL eines Fotos eine Weile gleich, und die alle drei Sekunden pollende
 * Eventseite lädt nicht bei jedem Abruf jedes Foto neu — im Hallen-WLAN spürbar.
 * Jede herausgegebene URL gilt damit noch mindestens zehn Minuten.
 */
const SIGNING_WINDOW_MS = 5 * 60 * 1000

function signingWindowStart(): Date {
  return new Date(Math.floor(Date.now() / SIGNING_WINDOW_MS) * SIGNING_WINDOW_MS)
}

export function createPhotoKey(participantId: string): string {
  return `participants/${participantId}/${randomBytes(16).toString('hex')}.webp`
}

/** Jeder Upload bekommt einen neuen Schlüssel — so darf die Logo-URL unbegrenzt gecacht werden. */
export function createLogoKey(eventId: string): string {
  return `events/${eventId}/logo-${randomBytes(8).toString('hex')}.webp`
}

/* ------------------------------------------------------------------- Lokal */

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function localPath(key: string): string {
  const base = resolve(serverRoot, env.STORAGE_LOCAL_DIR)
  const target = resolve(base, key)
  // Ein Schlüssel darf nie aus dem Upload-Verzeichnis herausführen.
  if (target !== base && !target.startsWith(base + '/')) {
    throw new Error(`Ungültiger Speicherschlüssel: ${key}`)
  }
  return target
}

function sign(key: string, expiresAt: number): string {
  return createHmac('sha256', env.SESSION_SECRET).update(`${key}:${expiresAt}`).digest('base64url')
}

/** Prüft die Signatur einer lokalen Medien-URL. Wird von der /media-Route benutzt. */
export function verifyMediaSignature(key: string, expiresAt: number, signature: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false

  const expected = Buffer.from(sign(key, expiresAt))
  const provided = Buffer.from(signature)
  if (expected.length !== provided.length) return false
  return timingSafeEqual(expected, provided)
}

export async function readLocalObject(key: string): Promise<Buffer> {
  return readFile(localPath(key))
}

const localStorage: PhotoStorage = {
  async put(key, body) {
    const target = localPath(key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body)
  },

  async remove(keys) {
    await Promise.all(keys.map((key) => rm(localPath(key), { force: true }).catch(() => undefined)))
  },

  async signedUrl(key) {
    const expiresAt = Math.floor(signingWindowStart().getTime() / 1000) + SIGNED_URL_TTL_SECONDS
    const query = new URLSearchParams({
      exp: String(expiresAt),
      sig: sign(key, expiresAt),
    })
    return `/media/${key}?${query.toString()}`
  },

  read: readLocalObject,
}

/* ---------------------------------------------------------------------- S3 */

function createS3Storage(): PhotoStorage {
  const client = new S3Client({
    region: env.S3_REGION,
    /*
     * Voreinstellung ist Virtual-Host-Stil (https://bucket.endpunkt/key) — so
     * arbeiten AWS S3 und die Railway-Buckets. Nur Speicher wie MinIO brauchen den
     * Pfad-Stil; dafür gibt es S3_FORCE_PATH_STYLE. Falsch herum eingestellt
     * scheitert jeder Upload mit einem wenig aussagekräftigen Fehler.
     */
    ...(env.S3_ENDPOINT
      ? { endpoint: env.S3_ENDPOINT, forcePathStyle: env.S3_FORCE_PATH_STYLE }
      : {}),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    },
  })
  const Bucket = env.S3_BUCKET!

  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      )
    },

    async remove(keys) {
      if (keys.length === 0) return
      // DeleteObjects nimmt maximal 1000 Schlüssel je Aufruf.
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000)
        await client.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })) },
          }),
        )
      }
    },

    async signedUrl(key) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), {
        expiresIn: SIGNED_URL_TTL_SECONDS,
        signingDate: signingWindowStart(),
      })
    },

    async read(key) {
      const object = await client.send(new GetObjectCommand({ Bucket, Key: key }))
      if (!object.Body) throw new Error(`Leeres Objekt im Speicher: ${key}`)
      return Buffer.from(await object.Body.transformToByteArray())
    },
  }
}

export const photoStorage: PhotoStorage =
  env.STORAGE_DRIVER === 's3' ? createS3Storage() : localStorage
