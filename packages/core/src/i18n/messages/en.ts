import type { Messages } from './de.js'

export const en: Messages = {
  common: {
    loading: 'One moment…',
    continue: 'Continue',
    skip: 'Skip',
    cancel: 'Cancel',
  },

  landing: {
    title: 'Scan the QR Code',
    body: 'Your host is showing a QR code. Scan it with your camera to join the event.',
  },

  intro: {
    notFoundTitle: 'Not found',
    notFound: 'This event doesn’t exist (anymore).',
    askHost: 'Ask your host for a current QR code.',
    welcome: 'Welcome to',
    teaser: 'You’re about to meet new people — with a little game that brings you together.',
    photoNotice:
      'For the game, you’ll take a photo of yourself. Everyone at the event can see your photo and first name – on the other players’ phones and on the big screen. Both are deleted automatically after the event.',
    join: 'Join',
  },

  join: {
    stepOf: (current, total) => `Step ${current} of ${total}`,
    nameTitle: 'What’s your name?',
    nameHint:
      'Just your first name – that’s how you’ll appear to the others and on the big screen.',
    nameLabel: 'First name',
    photoTitle: 'Now a photo',
    photoHint:
      'This is how the others will recognise you in the room. Look into the camera, face clearly visible.',
    photoAlt: 'Your photo',
    photoPrivacy:
      'Everyone at the event can see your photo: whoever is looking for you, on their phone – and after each match, the whole room on the big screen. It is deleted automatically after the event.',
    photoUploading: 'Uploading…',
    photoRetake: 'Retake photo',
    photoTake: 'Take photo',
    photoFailed: 'The photo couldn’t be uploaded.',
    profileTitle: 'Anything else about you?',
    profileHint:
      'Optional. It only becomes visible once you’ve found each other — before that, it would give the search away.',
    company: 'Company',
    role: 'Role',
  },

  calibration: {
    unsupportedTitle: 'Motion sensor not available',
    unsupportedBody:
      'This device doesn’t report any motion. You can still play — you’ll confirm your match with the tap of a button instead.',
    deniedTitle: 'No access to the sensor',
    deniedBody:
      'Without the motion sensor, the app can’t detect the bump. You can confirm your match with a button instead — or allow access later in your browser settings.',
    continueWithout: 'Continue without sensor',
    promptTitle: 'Quick sensor setup',
    promptBody:
      'In the game, you’ll tap your phones together — the motion sensor detects that. The app needs your permission once.',
    allow: 'Allow sensor',
    tapTitle: 'Tap your phone',
    tapBody: (count) =>
      `Tap your phone against your free hand ${count} times — as firmly as you would in the game.`,
    progress: (done, total) => `${done} of ${total}`,
  },

  play: {
    errorTitle: 'Connection problem',
    errorReload: 'Please reload the page.',
    connectingTitle: 'Connecting…',
    connectingBody: 'One moment, we’re getting you into the game.',
    noGameTitle: 'No game yet',
    noGameBody:
      'It’s about to start. Keep this page open — you’ll join automatically as soon as your host starts.',
    pausedTitle: 'Short break',
    pausedBody: 'Your host has paused the game.',
    waitingTitle: 'Starting soon',
    secondsUntilPairing: (seconds) =>
      seconds === 1 ? 'second until the next pairing' : 'seconds until the next pairing',
    pairingEvery: (seconds) => `New pairs are formed every ${seconds} seconds.`,
    idleTitle: 'Enjoy the conversation',
    idleBody: 'You’re currently out of the pairing. Tap here whenever you want to continue.',
    rejoin: 'Join again',
    matchCount: (count) => (count === 1 ? '1 encounter so far' : `${count} encounters so far`),
  },

  findMe: {
    findPerson: 'Find this person',
    sensorReady: 'Sensor ready',
    noSensor: 'No sensor',
    noPhoto: 'No photo',
    bumpDetected: (name) => `Bump detected — waiting for ${name}…`,
    instruction: 'Found them? Hold your phones together and give them a quick tap.',
    allowSensor: 'Allow motion sensor',
    simulateBump: 'Simulate bump (development only)',
    manualConfirm: 'We found each other',
    cantFind: 'I can’t find them',
    timeLeft: (duration) => `${duration} left`,
    matchNumber: (count) => `Match #${count}`,
    matchedTitle: 'You found each other',
    keepTalking: 'Chat for a while',
    keepSearching: 'Keep searching',
  },

  privacy: {
    deleteData: 'Delete my data',
    deleteExplanation:
      'Your photo, first name and profile are deleted immediately, and you leave the game. Your encounters so far remain as a number in the statistics — without any link to you.',
    deleting: 'Deleting…',
    delete: 'Delete',
  },

  errors: {
    unknown: 'That didn’t work.',
    internal: 'Something went wrong just now.',
    unauthorized: 'Your session is no longer valid. Please scan the QR code again.',
    invalid_session: 'Your session is no longer valid. Please scan the QR code again.',
    invalid_payload: 'Some details are missing or invalid.',
    event_not_found: 'This event doesn’t exist (anymore).',
    no_file: 'No photo was sent.',
    not_an_image: 'Please upload an image.',
    broken_image: 'The image couldn’t be processed.',
    photo_too_large: 'The image is too large.',
  },
}
