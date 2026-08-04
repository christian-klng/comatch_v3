import type { FastifyInstance } from 'fastify'
import { env } from '../env.js'
import { forbidden, notFound } from '../lib/errors.js'
import { readLocalObject, verifyMediaSignature } from '../lib/storage.js'

/**
 * Auslieferung der Fotos im lokalen Speichermodus.
 *
 * In Produktion übernimmt das der Objektspeicher über Presigned URLs — diese Route
 * existiert nur, damit sich die Entwicklung genauso verhält: signierte, kurzlebige
 * URLs statt eines offen erreichbaren Verzeichnisses.
 */
export function registerMediaRoutes(app: FastifyInstance): void {
  if (env.STORAGE_DRIVER !== 'local') return

  app.get<{ Params: { '*': string }; Querystring: { exp?: string; sig?: string } }>(
    '/media/*',
    async (request, reply) => {
      const key = request.params['*']
      const { exp, sig } = request.query

      if (!exp || !sig || !verifyMediaSignature(key, Number(exp), sig)) {
        throw forbidden('Diese Bild-URL ist ungültig oder abgelaufen.')
      }

      let body: Buffer
      try {
        body = await readLocalObject(key)
      } catch {
        throw notFound('media_not_found', 'Dieses Bild gibt es nicht.')
      }

      // Privat und nur so lange, wie die Signatur ohnehin gilt.
      reply.header('Cache-Control', 'private, max-age=900')
      reply.type('image/webp')
      return body
    },
  )
}
