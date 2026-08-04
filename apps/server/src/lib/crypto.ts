import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/*
 * promisify verliert die Überladung mit Optionen — ohne die Signatur hier ließen
 * sich die scrypt-Parameter nicht übergeben.
 */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>

/*
 * scrypt statt argon2 oder bcrypt: Es steckt in Node selbst, braucht also keine
 * native Abhängigkeit, die auf jedem Rechner und in jedem Container neu gebaut
 * werden müsste. Für eine Handvoll Admin-Zugänge ist das der richtige Kompromiss.
 */
const SCRYPT_KEYLEN = 64
const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1 } as const

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS)
  const { N, r, p } = SCRYPT_PARAMS
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts
  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false

  const salt = Buffer.from(rawSalt!, 'base64url')
  const expected = Buffer.from(rawHash!, 'base64url')

  const derived = await scryptAsync(password, salt, expected.length, { N, r, p })
  // Längenvergleich vorab, weil timingSafeEqual bei ungleicher Länge wirft.
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

/** Das Token, das der Teilnehmer im localStorage behält. */
export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/*
 * In der Datenbank liegt nur der Hash. Ein Datenbank-Leck gibt damit keine
 * übernehmbaren Sessions her. SHA-256 reicht: Das Token ist bereits 256 Bit
 * Zufall, es gibt nichts zu erraten und daher keinen Grund für eine langsame
 * Ableitung wie bei Passwörtern.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newId(): string {
  return randomUUID()
}

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/** Kurzer, gut abtippbarer Zufallsteil — ohne 0/O und 1/l/I. */
function randomSuffix(length = 4): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += SLUG_ALPHABET[bytes[i]! % SLUG_ALPHABET.length]
  }
  return out
}

/**
 * Slug für die Event-URL. Der Zufallsteil ist kein Schmuck: Ohne ihn könnte man
 * fremde Events durch Raten des Namens finden.
 */
export function createEventSlug(name: string): string {
  const base = name
    .toLowerCase()
    // Umlaute vor der Normalisierung ausschreiben, sonst würde aus „ä" ein „a"
    // statt „ae" — bei deutschen Eventnamen der häufigere Fall.
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  return `${base || 'event'}-${randomSuffix()}`
}
