import {
  CLIENT_EVENT,
  CLOCK_SYNC_INTERVAL_MS,
  CLOCK_SYNC_ROUNDS,
  HEARTBEAT_INTERVAL_MS,
  SERVER_EVENT,
  createClock,
  type ActivePair,
  type ClockPongPayload,
  type ErrorAck,
  type Game,
  type GameChangedPayload,
  type HelloAck,
  type MatchConfirmedPayload,
  type MatchRecord,
  type PairAssignedPayload,
  type PairEndedPayload,
  type Participant,
  type StatePayload,
} from '@comatch/core'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { API_URL } from '../api.js'

export type ConnectionStatus = 'connecting' | 'ready' | 'error'

export interface GameContextValue {
  status: ConnectionStatus
  error: string | null

  participant: Participant | null
  game: Game | null
  pair: ActivePair | null
  matches: MatchRecord[]
  /** Der zuletzt bestätigte Match, samt enthülltem Profil. */
  lastMatch: MatchConfirmedPayload | null
  nextTickAt: number | null

  clockSynced: boolean
  /** Geschätzte Serverzeit — Grundlage jedes Zeitvergleichs mit dem Gegenüber. */
  serverNow(): number
  toServerTime(localMs: number): number

  /** Zeitpunkt des eigenen erkannten Stoßes, in Serverzeit. Treibt die Anzeige. */
  ownSignalAt: number | null

  sendBump(pairId: string, t: number, magnitude: number): void
  sendManualConfirm(pairId: string): void
  cancelPair(pairId: string): void
  joinQueue(): void
  leaveQueue(): void
  dismissMatch(): void
}

const GameContext = createContext<GameContextValue | null>(null)

export function useGame(): GameContextValue {
  const value = useContext(GameContext)
  if (!value) throw new Error('useGame muss innerhalb von <GameProvider> stehen.')
  return value
}

export function GameProvider({
  sessionToken,
  onInvalidSession,
  children,
}: {
  sessionToken: string
  onInvalidSession: () => void
  children: React.ReactNode
}): React.ReactElement {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [pair, setPair] = useState<ActivePair | null>(null)
  const [matches, setMatches] = useState<MatchRecord[]>([])
  const [lastMatch, setLastMatch] = useState<MatchConfirmedPayload | null>(null)
  const [nextTickAt, setNextTickAt] = useState<number | null>(null)
  const [clockSynced, setClockSynced] = useState(false)
  const [ownSignalAt, setOwnSignalAt] = useState<number | null>(null)

  const socketRef = useRef<Socket | null>(null)
  const clockRef = useRef(createClock())
  /** Ausstehende Uhren-Pings: c0 → Sendezeitpunkt, zum Zuordnen der Antwort. */
  const pendingPings = useRef(new Map<number, number>())
  const onInvalidSessionRef = useRef(onInvalidSession)
  onInvalidSessionRef.current = onInvalidSession

  useEffect(() => {
    const clock = clockRef.current
    clock.reset()
    setClockSynced(false)

    const socket: Socket = io(API_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3_000,
    })
    socketRef.current = socket

    const runClockSync = () => {
      for (let round = 0; round < CLOCK_SYNC_ROUNDS; round += 1) {
        // Die Runden leicht versetzt senden: Fünf Pings im selben Tick würden sich
        // gegenseitig in der Warteschlange aufhalten und alle dieselbe Verzögerung messen.
        setTimeout(() => {
          const c0 = Date.now()
          pendingPings.current.set(c0, c0)
          socket.emit(CLIENT_EVENT.clockPing, { c0 })
        }, round * 120)
      }
    }

    const applyState = (payload: StatePayload) => {
      setParticipant(payload.participant)
      setGame(payload.game)
      setPair(payload.pair)
      setNextTickAt(payload.nextTickAt)
      if (!payload.pair) setOwnSignalAt(null)
    }

    socket.on('connect', () => {
      socket.emit(
        CLIENT_EVENT.hello,
        { sessionToken },
        (ack: HelloAck | ErrorAck) => {
          if (!ack.ok) {
            if (ack.code === 'invalid_session') {
              onInvalidSessionRef.current()
              return
            }
            setStatus('error')
            setError(ack.message)
            return
          }

          setParticipant(ack.participant)
          setGame(ack.game)
          setPair(ack.pair)
          setMatches(ack.matches)
          setNextTickAt(ack.nextTickAt)
          setStatus('ready')
          setError(null)
          runClockSync()
        },
      )
    })

    socket.on('connect_error', () => {
      setStatus('connecting')
      setError(null)
    })

    socket.on('disconnect', () => {
      setStatus('connecting')
    })

    socket.on(SERVER_EVENT.clockPong, (payload: ClockPongPayload) => {
      const sentAt = pendingPings.current.get(payload.c0)
      if (sentAt === undefined) return
      pendingPings.current.delete(payload.c0)

      clock.ingest({ c0: payload.c0, s: payload.s, c1: Date.now() })
      setClockSynced(clock.synced)
    })

    socket.on(SERVER_EVENT.state, applyState)

    socket.on(SERVER_EVENT.pairAssigned, (payload: PairAssignedPayload) => {
      setPair(payload.pair)
      setLastMatch(null)
      setOwnSignalAt(null)
      setParticipant((current) => (current ? { ...current, state: 'searching' } : current))
    })

    socket.on(SERVER_EVENT.pairEnded, (payload: PairEndedPayload) => {
      setPair((current) => (current?.id === payload.pairId ? null : current))
      setOwnSignalAt(null)
    })

    socket.on(SERVER_EVENT.matchConfirmed, (payload: MatchConfirmedPayload) => {
      /*
       * Der Server schickt danach keinen eigenen Zustand mehr — die Bestätigung
       * enthält bereits alles, was der Bildschirm braucht. Ein zusätzlicher Umlauf
       * würde den Moment nur verzögern, auf den beide gerade warten.
       */
      setPair(null)
      setOwnSignalAt(null)
      setLastMatch(payload)
      setParticipant((current) => (current ? { ...current, state: 'matched' } : current))
      setMatches((current) => [
        {
          pairId: payload.pairId,
          partner: payload.partner,
          confirmedAt: payload.confirmedAt,
        },
        ...current.filter((match) => match.pairId !== payload.pairId),
      ])
    })

    socket.on(SERVER_EVENT.gameChanged, (payload: GameChangedPayload) => {
      setGame(payload.game)
      if (!payload.game) {
        setPair(null)
        setNextTickAt(null)
      }
    })

    const heartbeat = setInterval(() => socket.emit(CLIENT_EVENT.heartbeat), HEARTBEAT_INTERVAL_MS)
    const resync = setInterval(runClockSync, CLOCK_SYNC_INTERVAL_MS)

    return () => {
      clearInterval(heartbeat)
      clearInterval(resync)
      pendingPings.current.clear()
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
  }, [sessionToken])

  const toServerTime = useCallback((localMs: number) => clockRef.current.toServerTime(localMs), [])
  const serverNow = useCallback(() => clockRef.current.toServerTime(Date.now()), [])

  const sendBump = useCallback((pairId: string, t: number, magnitude: number) => {
    setOwnSignalAt(t)
    socketRef.current?.emit(CLIENT_EVENT.bump, { pairId, t, magnitude })
  }, [])

  const sendManualConfirm = useCallback((pairId: string) => {
    const t = clockRef.current.toServerTime(Date.now())
    setOwnSignalAt(t)
    socketRef.current?.emit(CLIENT_EVENT.manualConfirm, { pairId, t })
  }, [])

  const cancelPair = useCallback((pairId: string) => {
    socketRef.current?.emit(CLIENT_EVENT.pairCancel, { pairId })
  }, [])

  const joinQueue = useCallback(() => {
    setLastMatch(null)
    socketRef.current?.emit(CLIENT_EVENT.queueJoin)
  }, [])

  const leaveQueue = useCallback(() => {
    setLastMatch(null)
    socketRef.current?.emit(CLIENT_EVENT.queueLeave)
  }, [])

  const dismissMatch = useCallback(() => setLastMatch(null), [])

  const value = useMemo<GameContextValue>(
    () => ({
      status,
      error,
      participant,
      game,
      pair,
      matches,
      lastMatch,
      nextTickAt,
      clockSynced,
      serverNow,
      toServerTime,
      ownSignalAt,
      sendBump,
      sendManualConfirm,
      cancelPair,
      joinQueue,
      leaveQueue,
      dismissMatch,
    }),
    [
      status,
      error,
      participant,
      game,
      pair,
      matches,
      lastMatch,
      nextTickAt,
      clockSynced,
      serverNow,
      toServerTime,
      ownSignalAt,
      sendBump,
      sendManualConfirm,
      cancelPair,
      joinQueue,
      leaveQueue,
      dismissMatch,
    ],
  )

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}
