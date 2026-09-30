/**
 * Ein Teilnehmer ohne Handy.
 *
 * Für das Testen des Spielablaufs am Rechner: verbindet sich wie die echte App und
 * lässt sich paaren. Mit `--confirm` tippt er kurz nach der Zuteilung „Wir haben uns
 * gefunden“ und schreibt seinen Code ins Terminal — den wählt man dann im Browser aus.
 * So entsteht die zweite Hälfte eines Matches, ohne ein zweites Gerät in die Hand zu
 * nehmen.
 *
 *   node apps/server/scripts/fake-participant.mjs <token> [--confirm] [--url http://localhost:4000]
 *
 * Tippt man im Browser zuerst, bekommt dieser Teilnehmer die Vorschläge und schreibt
 * sie nur ins Terminal: Welcher stimmt, weiß er so wenig wie ein echtes Gegenüber
 * ohne Blick auf das andere Handy.
 */
import { io } from 'socket.io-client'

const args = process.argv.slice(2)
const token = args.find((arg) => !arg.startsWith('--'))
const autoConfirm = args.includes('--confirm')
const urlIndex = args.indexOf('--url')
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4000'

if (!token) {
  console.error('Aufruf: node fake-participant.mjs <sessionToken> [--confirm]')
  process.exit(1)
}

const socket = io(url, { transports: ['websocket'] })
let confirmTimer = null

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
  if (!autoConfirm) return

  clearTimeout(confirmTimer)
  // Kurz warten, damit die Zuteilung im Browser erst einmal ankommt.
  confirmTimer = setTimeout(() => socket.emit('confirm:request', { pairId: pair.id }), 1_500)
})

// Code und Vorschläge kommen mit dem Zustand des Paares.
socket.on('state', ({ pair }) => {
  const confirmation = pair?.confirmation
  if (confirmation?.role === 'show') log(`Mein Code: ${confirmation.code}`)
  if (confirmation?.role === 'choose') log(`Vorschläge: ${confirmation.choices.join(' · ')}`)
  if (pair && !confirmation && pair.codeMisses > 0)
    log(`Falscher Code gewählt (${pair.codeMisses}×)`)
})

socket.on('pair:ended', ({ reason }) => {
  clearTimeout(confirmTimer)
  log(`Paar beendet: ${reason}`)
})

socket.on('match:confirmed', ({ partner, via, totalMatches }) => {
  clearTimeout(confirmTimer)
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
