import { FALLBACK_LOCALE, resolveLocale, type Locale } from '@comatch/core'

/**
 * Texte, die auf der Leinwand stehen — im Leinwand-Modus der Eventseite, samt der
 * QR-Lightbox. Gelesen werden sie vom Saal, deshalb in der Sprache des Events.
 *
 * Nur was im Leinwand-Modus tatsächlich sichtbar ist, gehört hierher. Knöpfe, Hinweise
 * und Diagnosezahlen, die nur die Steuerung zeigt, bleiben deutsch direkt im Code —
 * eine englische Fassung davon bekäme nie jemand zu sehen. Die Texte für die Handys
 * liegen in `@comatch/core`; sie wandern mit in die spätere iOS-App, diese hier nicht.
 */
const de = {
  loading: 'Einen Moment…',
  loadFailed: 'Das Event konnte nicht geladen werden.',
  archived: 'Archiviert',
  timeLocale: 'de-DE',
  /** Uhrzeit im Match-Feed; im Deutschen mit „Uhr". */
  clockTime: (time: string) => `${time} Uhr`,

  /** Der Ausgang bleibt schwach sichtbar auf dem Beamer stehen. */
  screenMode: {
    exit: 'Leinwand beenden',
    exitHint: 'Zurück zur Steuerung (Esc)',
  },

  sync: {
    connected: 'Verbunden',
    refreshHint: (seconds: number) => `Die Werte aktualisieren sich alle ${seconds} Sekunden.`,
    failed: 'Abruf fehlgeschlagen',
    offline: 'Keine Verbindung',
    asOf: (time: string) => `Stand ${time}`,
    unreachable: 'Der Server antwortet nicht. Die Seite versucht es weiter.',
  },

  game: {
    title: 'Spiel',
    none: 'Kein Spiel aktiv',
    starting: 'Startet gleich',
    running: 'Läuft',
    paused: 'Pausiert',
    ended: 'Beendet',
    newGameStartsIn: 'Neues Spiel startet in',
    findMeStartsIn: 'Find me startet in',
    go: 'Los!',
    requeueNotice: 'Wer gerade ein Match hat, kommt dann automatisch zurück in die Warteschlange.',
    findMe: 'Find me',
    findMeDescription:
      'Alle 10 Sekunden werden wartende Teilnehmer zufällig verbunden. Sie sehen nur das Foto ihres Partners und müssen ihn im Raum finden — bestätigt wird mit einem Stoß der Handys aneinander.',
    findMeRunning: (paused: boolean): string =>
      paused ? 'Find me läuft (pausiert)' : 'Find me läuft',
  },

  stats: {
    online: (total: number) => `von ${total} online`,
    searching: 'suchen gerade',
    encounters: 'Begegnungen',
  },

  feed: {
    title: 'Neueste Begegnungen',
    empty: 'Sobald sich zwei gefunden haben, erscheinen sie hier.',
  },

  qr: {
    title: 'QR-Code',
    alt: (eventName: string) => `QR-Code für ${eventName}`,
    generating: 'Wird erzeugt…',
    enlarge: 'Vergrößern',
    close: 'Schließen',
  },
}

export type ScreenTexts = typeof de

const en: ScreenTexts = {
  loading: 'One moment…',
  loadFailed: 'The event couldn’t be loaded.',
  archived: 'Archived',
  // Britisch statt amerikanisch: 24-Stunden-Uhr wie im Rest Europas.
  timeLocale: 'en-GB',
  clockTime: (time) => time,

  screenMode: {
    exit: 'Exit big screen',
    exitHint: 'Back to the controls (Esc)',
  },

  sync: {
    connected: 'Connected',
    refreshHint: (seconds) => `The figures refresh every ${seconds} seconds.`,
    failed: 'Update failed',
    offline: 'No connection',
    asOf: (time) => `as of ${time}`,
    unreachable: 'The server isn’t responding. The page keeps trying.',
  },

  game: {
    title: 'Game',
    none: 'No game active',
    starting: 'Starting soon',
    running: 'Running',
    paused: 'Paused',
    ended: 'Ended',
    newGameStartsIn: 'New game starts in',
    findMeStartsIn: 'Find me starts in',
    go: 'Go!',
    requeueNotice: 'Anyone who currently has a match will automatically rejoin the queue.',
    findMe: 'Find me',
    findMeDescription:
      'Every 10 seconds, waiting participants are paired at random. They only see their partner’s photo and have to find them in the room — confirmed by bumping their phones together.',
    findMeRunning: (paused) => (paused ? 'Find me is paused' : 'Find me is running'),
  },

  stats: {
    online: (total) => `of ${total} online`,
    searching: 'searching right now',
    encounters: 'Encounters',
  },

  feed: {
    title: 'Latest encounters',
    empty: 'As soon as two people find each other, they’ll appear here.',
  },

  qr: {
    title: 'QR code',
    alt: (eventName) => `QR code for ${eventName}`,
    generating: 'Generating…',
    enlarge: 'Enlarge',
    close: 'Close',
  },
}

export const SCREEN_TEXTS: Record<Locale, ScreenTexts> = { de, en }

/** Außerhalb des Leinwand-Modus bleibt alles deutsch, wie der Rest der Steuerung. */
export function screenTexts(locale: Locale, screen: boolean): ScreenTexts {
  return SCREEN_TEXTS[screen ? locale : 'de']
}

/**
 * Solange das Event noch lädt, ist seine Sprache unbekannt. Bis dahin gilt auf der
 * Leinwand die Regel der Startseite in der Teilnehmer-App: Browsersprache, sonst Englisch.
 */
export function pendingScreenTexts(screen: boolean): ScreenTexts {
  return screen ? SCREEN_TEXTS[resolveLocale(navigator.languages, FALLBACK_LOCALE)] : SCREEN_TEXTS.de
}
