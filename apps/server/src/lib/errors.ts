/**
 * Fehler mit stabilem Code. Der Code geht an den Client und ist Teil des
 * API-Vertrags — die Meldung ist für Menschen und darf sich jederzeit ändern.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message)
export const unauthorized = (message = 'Nicht angemeldet.') =>
  new AppError(401, 'unauthorized', message)
export const forbidden = (message = 'Nicht erlaubt.') => new AppError(403, 'forbidden', message)
export const notFound = (code: string, message: string) => new AppError(404, code, message)
export const conflict = (code: string, message: string) => new AppError(409, code, message)
export const payloadTooLarge = (message: string) => new AppError(413, 'payload_too_large', message)

/** Postgres meldet einen Verstoß gegen einen Unique-Index mit diesem Code. */
const UNIQUE_VIOLATION = '23505'

/**
 * Drizzle reicht den Fehler des Treibers nicht durch, sondern verpackt ihn — der Code
 * von Postgres steckt dann in `cause`. Beide Formen prüfen, damit ein Update von
 * Drizzle aus einem sauberen 409 nicht wieder stillschweigend einen 500er macht.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; depth < 3; depth += 1) {
    if (typeof current !== 'object' || current === null) return false
    if ('code' in current && current.code === UNIQUE_VIOLATION) return true
    current = 'cause' in current ? current.cause : null
  }
  return false
}
