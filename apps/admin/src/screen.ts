import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Der Leinwand-Modus steckt in der URL (`?leinwand`) statt im Zustand des Tabs:
 * So lässt sich ein zweiter Tab gezielt als Leinwand öffnen, während der erste die
 * Steuerung behält — und ein Neuladen am Beamer verliert den Modus nicht.
 */
const SCREEN_PARAM = 'leinwand'

export function useScreenMode(): [boolean, (on: boolean) => void] {
  const [params, setParams] = useSearchParams()

  const setScreen = useCallback(
    (on: boolean) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (on) next.set(SCREEN_PARAM, '1')
          else next.delete(SCREEN_PARAM)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  return [params.has(SCREEN_PARAM), setScreen]
}
