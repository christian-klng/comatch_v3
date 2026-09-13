import type { Locale } from '../locale.js'
import { de, type Messages } from './de.js'
import { en } from './en.js'

export type { Messages }

export const MESSAGES: Record<Locale, Messages> = { de, en }

/**
 * Übersetzt einen Fehlercode des Servers. Unbekannte Codes bekommen den allgemeinen
 * Text — nie die deutsche Servermeldung, die in einer englischen Oberfläche stünde.
 */
export function errorMessage(messages: Messages, code: string | null | undefined): string {
  if (code && Object.hasOwn(messages.errors, code)) {
    return messages.errors[code as keyof Messages['errors']]
  }
  return messages.errors.unknown
}
