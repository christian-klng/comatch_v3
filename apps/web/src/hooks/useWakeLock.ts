import { useEffect, useState } from 'react'

/**
 * Hält den Bildschirm wach, solange gesucht wird.
 *
 * Das ist keine Bequemlichkeit, sondern Voraussetzung: Sobald der Bildschirm
 * sperrt, hört `devicemotion` auf zu feuern — der Stoß würde dann nie erkannt.
 * Und ein Teilnehmer, der mit dem Partnerfoto durch den Raum läuft, tippt
 * minutenlang nichts an.
 */
export function useWakeLock(enabled: boolean): { supported: boolean; active: boolean } {
  const [active, setActive] = useState(false)
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

  useEffect(() => {
    if (!enabled || !supported) {
      setActive(false)
      return
    }

    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) {
          await sentinel.release()
          return
        }
        setActive(true)
        sentinel.addEventListener('release', () => setActive(false))
      } catch {
        // Wird etwa abgelehnt, wenn der Akku fast leer ist. Kein Grund zum Abbrechen.
        setActive(false)
      }
    }

    /*
     * Ein Wake Lock wird beim Tabwechsel automatisch freigegeben und kommt nicht von
     * allein zurück. Ohne diese Neuanforderung wäre er nach dem ersten Blick auf eine
     * andere App für den Rest der Runde weg.
     */
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cancelled) void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void sentinel?.release().catch(() => undefined)
      setActive(false)
    }
  }, [enabled, supported])

  return { supported, active }
}
