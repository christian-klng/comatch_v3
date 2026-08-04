import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { env, isProduction } from './env.js'
import { AppError } from './lib/errors.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerMediaRoutes } from './routes/media.js'

/** Ein Handyfoto in voller Auflösung liegt darunter, alles darüber ist kein Selfie. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(isProduction ? {} : { transport: { target: 'pino-pretty' } }),
    },
    // Railway und ähnliche Plattformen terminieren TLS vorgelagert. Ohne das
    // sähe der Server jede Anfrage als http und würde Secure-Cookies verwerfen.
    trustProxy: isProduction,
    bodyLimit: 1024 * 1024,
  })

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  await app.register(cookie, { secret: env.SESSION_SECRET })

  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  })

  app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({ code: error.code, message: error.message })
      return
    }

    if (error instanceof ZodError) {
      reply.code(400).send({
        code: 'invalid_payload',
        message: error.issues[0]?.message ?? 'Die Angaben sind unvollständig.',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      })
      return
    }

    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      reply.code(413).send({ code: 'photo_too_large', message: 'Das Bild ist zu groß.' })
      return
    }

    // Alles Unerwartete wird protokolliert, aber nicht nach außen beschrieben.
    request.log.error({ err: error }, 'Unbehandelter Fehler')
    reply.code(error.statusCode ?? 500).send({
      code: 'internal',
      message: 'Da ist gerade etwas schiefgegangen.',
    })
  })

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ code: 'not_found', message: 'Diese Route gibt es nicht.' })
  })

  registerHealthRoutes(app)
  registerMediaRoutes(app)

  return app
}
