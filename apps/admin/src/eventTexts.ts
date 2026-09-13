import { ApiError, FALLBACK_LOCALE, resolveLocale, type Locale } from '@comatch/core'

/**
 * Alle Texte der Eventseite — Steuerung, Leinwand-Modus und QR-Lightbox — in der
 * Sprache des Events. Wer ein englisches Event betreut, bedient es auch auf Englisch;
 * Eventliste, Anmeldung und Kopfzeile der Admin-App bleiben deutsch.
 *
 * Die Texte für die Handys liegen in `@comatch/core`; sie wandern mit in die spätere
 * iOS-App, diese hier nicht.
 */
const de = {
  loading: 'Einen Moment…',
  loadFailed: 'Das Event konnte nicht geladen werden.',
  cancel: 'Abbrechen',
  timeLocale: 'de-DE',
  /** Uhrzeit im Match-Feed; im Deutschen mit „Uhr". */
  clockTime: (time: string) => `${time} Uhr`,

  header: {
    rename: 'Umbenennen',
    save: 'Speichern',
    slugStays: 'Die Join-Adresse /e/… bleibt gleich.',
    archived: 'Archiviert',
    archive: 'Archivieren',
    archiveConfirm: 'Wirklich archivieren?',
    reactivate: 'Reaktivieren',
    screenMode: 'Leinwand-Modus',
    screenModeHint:
      'Blendet alles Bedienbare aus — für den Beamer. Gesteuert wird aus einem zweiten Tab; Esc beendet den Modus.',
    /** Der Ausgang bleibt schwach sichtbar auf dem Beamer stehen. */
    exitScreen: 'Leinwand beenden',
    exitScreenHint: 'Zurück zur Steuerung (Esc)',
  },

  locale: {
    label: 'Sprache des Events',
    hint: 'Die Sprache gilt für diese Seite, die Leinwand und Handys, die weder auf Deutsch noch auf Englisch eingestellt sind. Handys auf Deutsch oder Englisch zeigen weiter ihre eigene Sprache.',
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
    startsAfterCountdown: (seconds: number, requeues: boolean) =>
      `Das Spiel startet nach einem Countdown von ${seconds} Sekunden${
        requeues ? ' — Teilnehmer mit Match kommen dann automatisch zurück in die Warteschlange.' : '.'
      }`,
    startNew: 'Neues Spiel starten',
    startFindMe: 'Find me starten',
    archivedNoStart: 'In einem archivierten Event startet kein Spiel — erst reaktivieren.',
    pause: 'Pausieren',
    resume: 'Fortsetzen',
    end: 'Beenden',
    endConfirm: 'Wirklich beenden?',
    endedHint:
      'Ein beendetes Spiel lässt sich nicht wieder starten — danach kannst du ein neues beginnen. Solange eines läuft oder pausiert, geht kein zweites.',
  },

  stats: {
    online: (total: number) => `von ${total} online`,
    waiting: 'warten auf Zuteilung',
    searching: 'suchen gerade',
    encounters: 'Begegnungen',
    medianToMatch: 'Median bis Match',
    confirmedWithoutSensor: 'ohne Sensor bestätigt',
  },

  feed: {
    title: 'Neueste Begegnungen',
    empty: 'Sobald sich zwei gefunden haben, erscheinen sie hier.',
  },

  history: {
    title: (count: number) => `Bisherige Spiele (${count})`,
    run: 'Lauf',
    period: 'Zeitraum',
    withoutSensor: 'ohne Sensor',
  },

  participants: {
    title: 'Teilnehmer',
    titleWithCount: (count: number) => `Teilnehmer (${count})`,
    empty: 'Noch niemand da. Sobald jemand den QR-Code scannt, taucht er hier auf.',
    name: 'Name',
    state: 'Zustand',
    joinedAt: 'Dabei seit',
    remove: 'Entfernen',
    removeHint: 'Foto, Vorname und Profil löschen und die Session beenden',
    removeConfirm: 'Wirklich entfernen?',
    states: {
      onboarding: 'richtet ein',
      waiting: 'wartet',
      searching: 'sucht',
      matched: 'hat Match',
      idle: 'unterhält sich',
      offline: 'offline',
    },
  },

  retention: {
    title: 'Löschfrist',
    endsAt: 'Ende des Events',
    purgedAt: (date: string) => `Personendaten gelöscht am ${date}.`,
    overdue: 'Die Frist ist abgelaufen — der Server löscht beim nächsten Durchlauf (stündlich).',
    dueAt: (date: string) => `Fotos und Vornamen werden am ${date} automatisch gelöscht.`,
    notStarted: (hours: number) =>
      `Ohne Enddatum beginnt die Frist erst mit dem Archivieren (${hours} Stunden) — oder nach drei Tagen ohne Aktivität.`,
    purge: 'Personendaten jetzt löschen',
    purgeConfirm: 'Wirklich alle Personendaten löschen?',
    blockedByGame: 'Erst das laufende Spiel beenden.',
    nothingLeft: 'Es gibt nichts mehr zu löschen.',
    purgeHint:
      'Fotos, Vornamen und Profile aller Teilnehmer sind danach weg; die Zahlen der Auswertung bleiben. Das Event wird dabei archiviert.',
  },

  qr: {
    title: 'QR-Code',
    alt: (eventName: string) => `QR-Code für ${eventName}`,
    generating: 'Wird erzeugt…',
    enlarge: 'Vergrößern',
    close: 'Schließen',
    copy: 'Link kopieren',
    copied: 'Kopiert',
  },

  /** Wenn eine Aktion ohne verwertbare Antwort des Servers scheitert. */
  failures: {
    generic: 'Das hat nicht geklappt.',
    startGame: 'Das Spiel ließ sich nicht starten.',
    cancelCountdown: 'Der Countdown ließ sich nicht abbrechen.',
    purge: 'Die Personendaten ließen sich nicht löschen.',
    removeParticipant: 'Der Teilnehmer ließ sich nicht entfernen.',
  },

  /**
   * Nach Fehlercode des Servers. Seine eigenen Meldungen bleiben deutsch — der Code ist
   * der Vertrag, der Text nicht.
   */
  errors: {
    unauthorized: 'Die Anmeldung ist abgelaufen. Bitte neu anmelden.',
    invalid_payload: 'Die Angaben sind unvollständig.',
    internal: 'Da ist gerade etwas schiefgegangen.',
    event_not_found: 'Dieses Event gibt es nicht.',
    event_archived: 'In einem archivierten Event startet kein Spiel.',
    event_has_active_game: 'Beende zuerst das laufende Spiel.',
    game_already_active: 'In diesem Event läuft bereits ein Spiel.',
    countdown_running: 'Der Countdown läuft bereits.',
    game_not_found: 'Dieses Spiel gibt es nicht.',
    game_ended: 'Ein beendetes Spiel lässt sich nicht wieder starten.',
    participant_not_found: 'Diesen Teilnehmer gibt es nicht.',
  },
}

export type EventTexts = typeof de

const en: EventTexts = {
  loading: 'One moment…',
  loadFailed: 'The event couldn’t be loaded.',
  cancel: 'Cancel',
  // Britisch statt amerikanisch: 24-Stunden-Uhr und Tag vor Monat wie im Rest Europas.
  timeLocale: 'en-GB',
  clockTime: (time) => time,

  header: {
    rename: 'Rename',
    save: 'Save',
    slugStays: 'The join address /e/… stays the same.',
    archived: 'Archived',
    archive: 'Archive',
    archiveConfirm: 'Really archive?',
    reactivate: 'Reactivate',
    screenMode: 'Big screen',
    screenModeHint:
      'Hides all controls — for the projector. Control the event from a second tab; Esc leaves this mode.',
    exitScreen: 'Exit big screen',
    exitScreenHint: 'Back to the controls (Esc)',
  },

  locale: {
    label: 'Event language',
    hint: 'The language applies to this page, the big screen and phones set to neither German nor English. Phones set to German or English keep showing their own language.',
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
    startsAfterCountdown: (seconds, requeues) =>
      `The game starts after a ${seconds}-second countdown${
        requeues ? ' — participants with a match then automatically rejoin the queue.' : '.'
      }`,
    startNew: 'Start new game',
    startFindMe: 'Start Find me',
    archivedNoStart: 'No game can start in an archived event — reactivate it first.',
    pause: 'Pause',
    resume: 'Resume',
    end: 'End',
    endConfirm: 'Really end?',
    endedHint:
      'An ended game can’t be restarted — you can start a new one afterwards. While a game is running or paused, no second one can start.',
  },

  stats: {
    online: (total) => `of ${total} online`,
    waiting: 'waiting for a pairing',
    searching: 'searching right now',
    encounters: 'Encounters',
    medianToMatch: 'Median time to match',
    confirmedWithoutSensor: 'confirmed without sensor',
  },

  feed: {
    title: 'Latest encounters',
    empty: 'As soon as two people find each other, they’ll appear here.',
  },

  history: {
    title: (count) => `Previous games (${count})`,
    run: 'Run',
    period: 'Time',
    withoutSensor: 'without sensor',
  },

  participants: {
    title: 'Participants',
    titleWithCount: (count) => `Participants (${count})`,
    empty: 'Nobody here yet. As soon as someone scans the QR code, they’ll show up here.',
    name: 'Name',
    state: 'Status',
    joinedAt: 'Joined',
    remove: 'Remove',
    removeHint: 'Delete photo, first name and profile and end the session',
    removeConfirm: 'Really remove?',
    states: {
      onboarding: 'setting up',
      waiting: 'waiting',
      searching: 'searching',
      matched: 'matched',
      idle: 'chatting',
      offline: 'offline',
    },
  },

  retention: {
    title: 'Deletion period',
    endsAt: 'End of the event',
    purgedAt: (date) => `Personal data deleted on ${date}.`,
    overdue: 'The period has expired — the server deletes the data on its next run (hourly).',
    dueAt: (date) => `Photos and first names will be deleted automatically on ${date}.`,
    notStarted: (hours) =>
      `Without an end date, the period only starts once the event is archived (${hours} hours) — or after three days without activity.`,
    purge: 'Delete personal data now',
    purgeConfirm: 'Really delete all personal data?',
    blockedByGame: 'End the running game first.',
    nothingLeft: 'There is nothing left to delete.',
    purgeHint:
      'Photos, first names and profiles of all participants will be gone; the statistics remain. The event is archived in the process.',
  },

  qr: {
    title: 'QR code',
    alt: (eventName) => `QR code for ${eventName}`,
    generating: 'Generating…',
    enlarge: 'Enlarge',
    close: 'Close',
    copy: 'Copy link',
    copied: 'Copied',
  },

  failures: {
    generic: 'That didn’t work.',
    startGame: 'The game couldn’t be started.',
    cancelCountdown: 'The countdown couldn’t be cancelled.',
    purge: 'The personal data couldn’t be deleted.',
    removeParticipant: 'The participant couldn’t be removed.',
  },

  errors: {
    unauthorized: 'Your login has expired. Please sign in again.',
    invalid_payload: 'Some details are missing or invalid.',
    internal: 'Something went wrong just now.',
    event_not_found: 'This event doesn’t exist.',
    event_archived: 'No game can start in an archived event.',
    event_has_active_game: 'End the running game first.',
    game_already_active: 'A game is already running in this event.',
    countdown_running: 'The countdown is already running.',
    game_not_found: 'This game doesn’t exist.',
    game_ended: 'An ended game can’t be restarted.',
    participant_not_found: 'This participant doesn’t exist.',
  },
}

export const EVENT_TEXTS: Record<Locale, EventTexts> = { de, en }

export function eventTexts(locale: Locale): EventTexts {
  return EVENT_TEXTS[locale]
}

/**
 * Solange das Event noch lädt, ist seine Sprache unbekannt. Auf der Eventseite gilt bis
 * dahin die Regel der Startseite in der Teilnehmer-App: Browsersprache, sonst Englisch.
 * Überall sonst bleibt die Admin-App deutsch.
 */
export function pendingEventTexts(onEventPage: boolean): EventTexts {
  return onEventPage ? EVENT_TEXTS[resolveLocale(navigator.languages, FALLBACK_LOCALE)] : de
}

/**
 * Ein gescheiterter Aufruf als Text. Bekannte Codes des Servers werden übersetzt; ohne
 * verwertbare Antwort — Funkloch, unbekannter Code — gilt `fallback`.
 */
export function describeError(texts: EventTexts, cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && Object.hasOwn(texts.errors, cause.code)) {
    return texts.errors[cause.code as keyof EventTexts['errors']]
  }
  return fallback
}
