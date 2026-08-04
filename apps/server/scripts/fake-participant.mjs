/**
 * Ein Teilnehmer ohne Handy.
 *
 * Für das Testen des Spielablaufs am Rechner: verbindet sich wie die echte App,
 * lässt sich paaren und kann auf Wunsch im Sekundentakt einen Stoß melden — damit
 * lässt sich die zweite Hälfte eines Matches erzeugen, ohne ein zweites Gerät in die
 * Hand zu nehmen.
 *
 *   node apps/server/scripts/fake-participant.mjs <token> [--bump] [--url http://localhost:4000]
 *
 * Für die echte Abnahme ersetzt das kein Gerätepaar: Ob die Bump-Erkennung im Raum
 * trägt, zeigt sich nur mit zwei echten Handys.
 */
import { io } from 'socket.io-client'

const args = process.argv.slice(2)
const token = args.find((arg) => !arg.startsWith('--'))
const autoBump = args.includes('--bump')
const urlIndex = args.indexOf('--url')
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4000'

if (!token) {
  console.error('Aufruf: node fake-participant.mjs <sessionToken> [--bump]')
  process.exit(1)
}

const socket = io(url, { transports: ['websocket'] })
let bumpTimer = null

const log = (...parts) => console.log(new Date().toISOString().slice(11, 23), ...parts)

socket.on('connect', () => {
  socket.emit('hello', { sessionToken: token }, (ack) => {
    if (!ack.ok) {
      console.error('Anmeldung abgelehnt:', ack)
      process.exit(1)
    }
    log(`angemeldet als ${ack.participant.displayName} (${ack.participant.state})`)
    if (ack.pair) log(`laufendes Paar mit ${ack.pair.partner.displayName}`)
  })
})

// Heartbeat, sonst fällt dieser Teilnehmer nach 20 Sekunden aus dem Pool.
setInterval(() => socket.emit('heartbeat'), 5_000)

socket.on('pair:assigned', ({ pair }) => {
  log(`Paar zugewiesen: ${pair.partner.displayName} (${pair.id})`)
  if (!autoBump) return

  clearInterval(bumpTimer)
  /*
   * Im Sekundentakt stoßen, statt einmalig: Das Gegenüber am Browser tippt zu einem
   * unbekannten Zeitpunkt. Bei 1 s Abstand liegt jeder fremde Stoß höchstens 500 ms
   * neben einem eigenen und damit sicher im Zeitfenster des Servers.
   */
  bumpTimer = setInterval(() => {
    socket.emit('signal:bump', { pairId: pair.id, t: Date.now(), magnitude: 22 })
  }, 1_000)
})

socket.on('pair:ended', ({ reason }) => {
  clearInterval(bumpTimer)
  log(`Paar beendet: ${reason}`)
})

socket.on('match:confirmed', ({ partner, via, totalMatches }) => {
  clearInterval(bumpTimer)
  log(`MATCH mit ${partner.displayName} über ${via} — insgesamt ${totalMatches}`)
  // Nach kurzer Verschnaufpause zurück in den Pool.
  setTimeout(() => socket.emit('queue:join'), 2_000)
})

socket.on('game:changed', ({ game }) => log(`Spiel: ${game?.state ?? 'beendet'}`))
socket.on('disconnect', () => log('getrennt'))

process.on('SIGINT', () => {
  socket.disconnect()
  process.exit(0)
})
