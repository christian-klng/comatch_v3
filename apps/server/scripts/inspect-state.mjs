/**
 * Zeigt, was der Server einem Teilnehmer beim Verbinden über seinen Zustand mitteilt.
 * Diagnosewerkzeug für die Entwicklung:
 *
 *   node apps/server/scripts/inspect-state.mjs <token> [--url http://localhost:4000]
 */
import { io } from 'socket.io-client'

const args = process.argv.slice(2)
const token = args.find((arg) => !arg.startsWith('--'))
const urlIndex = args.indexOf('--url')
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4000'

const socket = io(url, { transports: ['websocket'] })

socket.on('connect', () => {
  socket.emit('hello', { sessionToken: token }, (ack) => {
    console.log(
      JSON.stringify(
        {
          ok: ack.ok,
          zustand: ack.participant?.state,
          spiel: ack.game?.state ?? null,
          paar: ack.pair?.id ?? null,
          begegnungen: ack.matches?.length,
        },
        null,
        2,
      ),
    )
    // `state` folgt kurz darauf und trägt zusätzlich den nächsten Takt.
    setTimeout(() => {
      socket.disconnect()
      process.exit(0)
    }, 1_500)
  })
})

socket.on('state', (payload) => {
  console.log(
    'state:',
    JSON.stringify({
      zustand: payload.participant.state,
      nextTickAt: payload.nextTickAt,
      inMs: payload.nextTickAt === null ? null : payload.nextTickAt - payload.serverTime,
    }),
  )
})
