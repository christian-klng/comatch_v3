/**
 * Alle Texte, die Teilnehmende sehen — die deutsche Fassung ist die Vorlage.
 *
 * Aus ihr leitet sich der Typ `Messages` ab, gegen den jede andere Sprache geprüft
 * wird: Ein Schlüssel, der dort fehlt, lässt den Typecheck scheitern. Texte mit
 * Zahlen oder Namen sind Funktionen, damit Satzbau und Plural je Sprache stimmen.
 *
 * Gegliedert nach Bildschirmen; jedes Spiel bringt einen eigenen Abschnitt mit.
 */
export const de = {
  common: {
    loading: 'Einen Moment…',
    continue: 'Weiter',
    skip: 'Überspringen',
    cancel: 'Abbrechen',
  },

  landing: {
    title: 'Scanne den QR-Code',
    body: 'Dein Gastgeber zeigt einen QR-Code. Scanne ihn mit der Kamera, um beim Event mitzumachen.',
  },

  intro: {
    notFoundTitle: 'Nicht gefunden',
    notFound: 'Dieses Event gibt es nicht (mehr).',
    askHost: 'Frage deinen Gastgeber nach einem aktuellen QR-Code.',
    welcome: 'Willkommen bei',
    teaser:
      'Gleich lernst du hier neue Leute kennen — mit einem kleinen Spiel, das euch zusammenbringt.',
    photoNotice:
      'Für das Spiel machst du ein Foto von dir. Foto und Vorname sehen alle auf dem Event – auf den Handys der Mitspielenden und auf der Leinwand. Nach dem Event wird beides automatisch gelöscht.',
    join: 'Mitmachen',
  },

  join: {
    stepOf: (current: number, total: number) => `Schritt ${current} von ${total}`,
    nameTitle: 'Wie heißt du?',
    nameHint: 'Nur dein Vorname – so erscheinst du bei den anderen und auf der Leinwand.',
    nameLabel: 'Vorname',
    photoTitle: 'Jetzt ein Foto',
    photoHint:
      'Daran erkennen dich die anderen im Raum. Schau in die Kamera, Gesicht gut sichtbar.',
    photoAlt: 'Dein Foto',
    photoPrivacy:
      'Dein Foto sehen alle auf dem Event: wer dich gerade sucht, auf dem Handy – und nach jedem Match der ganze Saal auf der Leinwand. Nach dem Event wird es automatisch gelöscht.',
    photoUploading: 'Wird geladen…',
    photoRetake: 'Neues Foto',
    photoTake: 'Foto aufnehmen',
    photoFailed: 'Das Bild konnte nicht geladen werden.',
    profileTitle: 'Noch etwas über dich?',
    profileHint:
      'Freiwillig. Sichtbar wird das erst, wenn ihr euch gefunden habt — vorher würde es die Suche verraten.',
    company: 'Unternehmen',
    role: 'Rolle',
  },

  calibration: {
    unsupportedTitle: 'Bewegungssensor nicht verfügbar',
    unsupportedBody:
      'Dieses Gerät meldet keine Bewegung. Du kannst trotzdem mitspielen — den Match bestätigt ihr dann mit einem Knopfdruck.',
    deniedTitle: 'Kein Zugriff auf den Sensor',
    deniedBody:
      'Ohne Bewegungssensor erkennt die App den Stoß nicht. Du kannst den Match stattdessen mit einem Knopfdruck bestätigen — oder den Zugriff später in den Einstellungen deines Browsers erlauben.',
    continueWithout: 'Ohne Sensor weiter',
    promptTitle: 'Kurz den Sensor einrichten',
    promptBody:
      'Im Spiel haltet ihr eure Handys aneinander — das erkennt der Bewegungssensor. Dafür braucht die App einmalig deine Erlaubnis.',
    allow: 'Sensor erlauben',
    tapTitle: 'Stoß dein Handy an',
    tapBody: (count: number) =>
      `Tippe dein Handy ${count}× gegen deine freie Hand — so kräftig, wie du es gleich beim Spiel machen würdest.`,
    progress: (done: number, total: number) => `${done} von ${total}`,
  },

  play: {
    errorTitle: 'Verbindung gestört',
    errorReload: 'Bitte lade die Seite neu.',
    connectingTitle: 'Verbinde…',
    connectingBody: 'Einen Moment, wir bringen dich ins Spiel.',
    noGameTitle: 'Noch kein Spiel',
    noGameBody:
      'Gleich geht es los. Lass die Seite offen — du bist automatisch dabei, sobald dein Gastgeber startet.',
    pausedTitle: 'Kurze Pause',
    pausedBody: 'Dein Gastgeber hat das Spiel angehalten.',
    waitingTitle: 'Gleich geht’s los',
    secondsUntilPairing: (seconds: number): string =>
      seconds === 1 ? 'Sekunde bis zur nächsten Zuteilung' : 'Sekunden bis zur nächsten Zuteilung',
    pairingEvery: (seconds: number) => `Alle ${seconds} Sekunden werden neue Paare gebildet.`,
    idleTitle: 'Viel Spaß beim Gespräch',
    idleBody: 'Du bist gerade aus der Zuteilung raus. Wenn du weitermachen willst, tippe hier.',
    rejoin: 'Wieder mitmachen',
    matchCount: (count: number) =>
      count === 1 ? '1 Begegnung bisher' : `${count} Begegnungen bisher`,
  },

  findMe: {
    findPerson: 'Finde diese Person',
    sensorReady: 'Sensor bereit',
    noSensor: 'Kein Sensor',
    noPhoto: 'Kein Foto',
    bumpDetected: (name: string) => `Stoß erkannt — warte auf ${name}…`,
    instruction: 'Gefunden? Haltet eure Handys aneinander und stoßt kurz an.',
    allowSensor: 'Bewegungssensor erlauben',
    simulateBump: 'Stoß simulieren (nur Entwicklung)',
    manualConfirm: 'Wir haben uns gefunden',
    cantFind: 'Ich finde die Person nicht',
    timeLeft: (duration: string) => `noch ${duration}`,
    matchNumber: (count: number) => `Match #${count}`,
    matchedTitle: 'Ihr habt euch gefunden',
    keepTalking: 'Erstmal unterhalten',
    keepSearching: 'Weiter suchen',
  },

  privacy: {
    deleteData: 'Meine Daten löschen',
    deleteExplanation:
      'Foto, Vorname und Profil werden sofort gelöscht, und du bist aus dem Spiel raus. Deine bisherigen Begegnungen bleiben als Zahl in der Auswertung — ohne Bezug zu dir.',
    deleting: 'Wird gelöscht…',
    delete: 'Löschen',
  },

  /**
   * Nach Fehlercode des Servers. Seine eigenen Meldungen bleiben deutsch und dienen
   * nur noch Log und Entwicklung — der Code ist der Vertrag, der Text nicht.
   */
  errors: {
    unknown: 'Das hat nicht geklappt.',
    internal: 'Da ist gerade etwas schiefgegangen.',
    unauthorized: 'Deine Sitzung gilt nicht mehr. Scanne den QR-Code bitte erneut.',
    invalid_session: 'Deine Sitzung gilt nicht mehr. Scanne den QR-Code bitte erneut.',
    invalid_payload: 'Die Angaben sind unvollständig.',
    event_not_found: 'Dieses Event gibt es nicht (mehr).',
    no_file: 'Es wurde kein Bild mitgeschickt.',
    not_an_image: 'Bitte ein Bild hochladen.',
    broken_image: 'Das Bild konnte nicht verarbeitet werden.',
    photo_too_large: 'Das Bild ist zu groß.',
  },
}

export type Messages = typeof de
