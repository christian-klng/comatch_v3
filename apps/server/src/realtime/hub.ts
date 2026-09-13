import type { ServerToClientEvents } from '@comatch/core'

/**
 * Schmale Sicht auf den Realtime-Transport.
 *
 * Der Spielmotor kennt nur dieses Interface und nicht Socket.io — dadurch lässt er
 * sich mit einem Attrappen-Hub testen, ohne einen Server hochzufahren.
 */
export interface Hub {
  toParticipant<E extends keyof ServerToClientEvents>(
    participantId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void

  toEvent<E extends keyof ServerToClientEvents>(
    eventId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void

  /**
   * Trennt alle Verbindungen eines Teilnehmers. Sein nächster Verbindungsaufbau
   * läuft wieder über `hello` — und scheitert dort, wenn er gelöscht wurde.
   */
  disconnectParticipant(participantId: string): void

  /** Wie oben, für alle Teilnehmer eines Events — nach dem Bereinigen des Events. */
  disconnectEvent(eventId: string): void
}

export const participantRoom = (participantId: string) => `participant:${participantId}`
export const eventRoom = (eventId: string) => `event:${eventId}`
