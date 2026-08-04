/**
 * Die Teilnehmer-Session.
 *
 * Ein Zufallstoken im localStorage — kein Konto, kein Passwort. Es überlebt Reload
 * und Bildschirmsperre, und genau darauf kommt es auf einem Event an: Wer das Handy
 * einsteckt und wieder herausholt, soll dort weitermachen, wo er war.
 *
 * Abgelegt wird nach Event-Slug, damit jemand an zwei Events teilnehmen kann, ohne
 * dass eine Session die andere überschreibt.
 */

const STORAGE_KEY = 'comatch.sessions'

interface StoredSession {
  token: string
  participantId: string
}

type SessionMap = Record<string, StoredSession>

function readAll(): SessionMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as SessionMap) : {}
  } catch {
    // Privater Modus oder beschädigter Eintrag — dann eben ohne gespeicherte Session.
    return {}
  }
}

function writeAll(sessions: SessionMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    // Kein Speicher verfügbar. Die Session gilt dann nur für diesen Tab.
  }
}

export function loadSession(slug: string): StoredSession | null {
  return readAll()[slug] ?? null
}

export function saveSession(slug: string, session: StoredSession): void {
  writeAll({ ...readAll(), [slug]: session })
}

export function clearSession(slug: string): void {
  const all = readAll()
  delete all[slug]
  writeAll(all)
}

/* --------------------------------------------------------- Bump-Kalibrierung */

const THRESHOLD_KEY = 'comatch.bumpThreshold'

/**
 * Die kalibrierte Schwelle gehört zum Gerät, nicht zum Event — sie hängt an der
 * Sensorempfindlichkeit dieses Handys und gilt beim nächsten Event genauso.
 */
export function loadBumpThreshold(): number | null {
  try {
    const raw = localStorage.getItem(THRESHOLD_KEY)
    const value = raw ? Number(raw) : NaN
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export function saveBumpThreshold(threshold: number): void {
  try {
    localStorage.setItem(THRESHOLD_KEY, String(threshold))
  } catch {
    // Ohne Speicher gilt die Schwelle nur für diese Sitzung.
  }
}
