import { PRESENCE_TIMEOUT_MS } from '@comatch/core'

/**
 * Wer ist gerade wirklich da?
 *
 * Bewusst im Arbeitsspeicher und nicht in der Datenbank: Der Matcher fragt das alle
 * 10 Sekunden für jeden Wartenden ab, und ein Heartbeat im 5-Sekunden-Takt mal
 * hundert Teilnehmer wären 20 Schreibvorgänge pro Sekunde für eine Information, die
 * einen Serverneustart ohnehin nicht überleben muss — danach verbinden sich alle neu.
 *
 * Das setzt voraus, dass der Server als **eine** Instanz läuft. Dieselbe Annahme
 * trifft der Matcher-Takt; beides ist in README und Railway-Konfiguration festgehalten.
 */
interface PresenceEntry {
  participantId: string
  eventId: string
  lastSeen: number
  sockets: Set<string>
}

const byParticipant = new Map<string, PresenceEntry>()
const socketToParticipant = new Map<string, string>()

export const presence = {
  connect(participantId: string, eventId: string, socketId: string): void {
    const existing = byParticipant.get(participantId)
    if (existing) {
      existing.sockets.add(socketId)
      existing.lastSeen = Date.now()
    } else {
      byParticipant.set(participantId, {
        participantId,
        eventId,
        lastSeen: Date.now(),
        sockets: new Set([socketId]),
      })
    }
    socketToParticipant.set(socketId, participantId)
  },

  /** Gibt den Teilnehmer zurück, falls das seine **letzte** Verbindung war. */
  disconnect(socketId: string): string | null {
    const participantId = socketToParticipant.get(socketId)
    if (!participantId) return null
    socketToParticipant.delete(socketId)

    const entry = byParticipant.get(participantId)
    if (!entry) return null

    entry.sockets.delete(socketId)
    if (entry.sockets.size > 0) return null

    byParticipant.delete(participantId)
    return participantId
  },

  touch(participantId: string): void {
    const entry = byParticipant.get(participantId)
    if (entry) entry.lastSeen = Date.now()
  },

  isOnline(participantId: string): boolean {
    const entry = byParticipant.get(participantId)
    if (!entry) return false
    return Date.now() - entry.lastSeen <= PRESENCE_TIMEOUT_MS
  },

  socketsOf(participantId: string): string[] {
    return [...(byParticipant.get(participantId)?.sockets ?? [])]
  },

  onlineCount(eventId: string): number {
    let count = 0
    for (const entry of byParticipant.values()) {
      if (entry.eventId === eventId && Date.now() - entry.lastSeen <= PRESENCE_TIMEOUT_MS) {
        count += 1
      }
    }
    return count
  },

  /**
   * Entfernt Teilnehmer, deren Heartbeat ausgeblieben ist, und gibt sie zurück.
   * Fängt den Fall ab, dass ein Gerät ohne sauberes Disconnect verschwindet —
   * auf einem Event der Normalfall, nicht die Ausnahme.
   */
  prune(): Array<{ participantId: string; eventId: string }> {
    const now = Date.now()
    const dropped: Array<{ participantId: string; eventId: string }> = []

    for (const entry of [...byParticipant.values()]) {
      if (now - entry.lastSeen <= PRESENCE_TIMEOUT_MS) continue
      byParticipant.delete(entry.participantId)
      for (const socketId of entry.sockets) socketToParticipant.delete(socketId)
      dropped.push({ participantId: entry.participantId, eventId: entry.eventId })
    }

    return dropped
  },

  clear(): void {
    byParticipant.clear()
    socketToParticipant.clear()
  },
}
