import type { EventSummary } from '@comatch/core'

/**
 * Kalendertage aus `<input type="date">` und die ISO-Zeitpunkte der API.
 *
 * Ein Tag wird zum ganzen Tag in der Zeitzone dieses Browsers: Beginn um Mitternacht,
 * Ende eine Millisekunde vor der nächsten. So läuft die Löschfrist erst nach dem
 * letzten Abend an, nicht schon am Morgen des Eventtags.
 */
export function dayToStart(day: string): string {
  return new Date(`${day}T00:00:00`).toISOString()
}

export function dayToEnd(day: string): string {
  return new Date(`${day}T23:59:59.999`).toISOString()
}

/** Der Kalendertag eines Zeitpunkts, wie ihn das Datumsfeld erwartet (JJJJ-MM-TT). */
export function toDayInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatDateRange(event: Pick<EventSummary, 'startsAt' | 'endsAt'>): string {
  const day = (iso: string) => new Date(iso).toLocaleDateString('de-DE')
  if (event.startsAt && event.endsAt && day(event.startsAt) !== day(event.endsAt)) {
    return `${day(event.startsAt)} – ${day(event.endsAt)}`
  }
  const single = event.startsAt ?? event.endsAt
  return single ? day(single) : '—'
}

export function formatDateTime(iso: string | number): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
