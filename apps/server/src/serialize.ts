import type {
  ActivePair,
  DesignTemplate,
  EventLogo,
  EventSummary,
  Game,
  MatchRecord,
  Participant,
  PartnerPublic,
  PartnerRevealed,
} from '@comatch/core'
import type { DesignTemplateRow, EventRow, GameRow, PairRow, ParticipantRow } from './db/schema.js'
import { photoStorage } from './lib/storage.js'

/**
 * Datenbankzeilen in die Typen aus @comatch/core übersetzen.
 *
 * Alles, was ein Foto enthält, ist asynchron: Die Bild-URL wird bei jeder Ausgabe
 * frisch signiert und ist nur kurz gültig. Es gibt bewusst keine gespeicherte URL,
 * die man weiterreichen könnte.
 */

async function photoUrl(key: string | null): Promise<string | null> {
  return key ? photoStorage.signedUrl(key) : null
}

/**
 * Anders als ein Foto ist das Logo öffentlich und bekommt eine dauerhafte Adresse —
 * eine alle paar Minuten wechselnde Signatur ließe es auf der Leinwand flackern. Der
 * Schlüssel wechselt mit jedem Upload; als `v` angehängt, macht er die URL cachebar.
 */
export function toEventLogo(
  row: Pick<EventRow, 'slug' | 'logoKey' | 'logoTone'>,
): EventLogo | null {
  if (!row.logoKey || !row.logoTone) return null
  const version = /logo-([0-9a-f]+)\.webp$/.exec(row.logoKey)?.[1] ?? ''
  return {
    url: `/api/events/${encodeURIComponent(row.slug)}/logo?v=${version}`,
    tone: row.logoTone,
  }
}

export function toEventSummary(row: EventRow): EventSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    purgedAt: row.purgedAt?.toISOString() ?? null,
    locale: row.locale,
    design: row.design,
    logo: toEventLogo(row),
  }
}

export function toDesignTemplate(row: DesignTemplateRow): DesignTemplate {
  return {
    id: row.id,
    name: row.name,
    design: row.design,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toGame(row: GameRow): Game {
  return {
    id: row.id,
    eventId: row.eventId,
    type: row.type,
    state: row.state,
    config: row.config,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  }
}

export async function toParticipant(row: ParticipantRow): Promise<Participant> {
  return {
    id: row.id,
    eventId: row.eventId,
    displayName: row.displayName,
    photoUrl: await photoUrl(row.photoKey),
    profile: row.profile,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Was während der Suche sichtbar ist: Foto und Vorname. Sonst nichts. */
export async function toPartnerPublic(row: ParticipantRow): Promise<PartnerPublic> {
  return {
    id: row.id,
    displayName: row.displayName,
    photoUrl: await photoUrl(row.photoKey),
  }
}

/** Erst nach einem bestätigten Match — vorher würde das Profil die Suche verraten. */
export async function toPartnerRevealed(row: ParticipantRow): Promise<PartnerRevealed> {
  return {
    ...(await toPartnerPublic(row)),
    profile: row.profile,
  }
}

export async function toActivePair(pair: PairRow, partner: ParticipantRow): Promise<ActivePair> {
  return {
    id: pair.id,
    partner: await toPartnerPublic(partner),
    expiresAt: pair.expiresAt.getTime(),
    createdAt: pair.createdAt.getTime(),
  }
}

export async function toMatchRecord(pair: PairRow, partner: ParticipantRow): Promise<MatchRecord> {
  return {
    pairId: pair.id,
    partner: await toPartnerRevealed(partner),
    confirmedAt: (pair.confirmedAt ?? pair.createdAt).toISOString(),
  }
}

/** Die andere Hälfte eines Paares. */
export function partnerIdOf(pair: Pick<PairRow, 'aId' | 'bId'>, participantId: string): string {
  return pair.aId === participantId ? pair.bId : pair.aId
}
