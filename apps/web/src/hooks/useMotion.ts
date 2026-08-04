import type { MotionSample } from '@comatch/core'
import { useCallback, useEffect, useRef, useState } from 'react'

export type MotionPermission = 'unsupported' | 'prompt' | 'granted' | 'denied'

/** iOS ab 13 verlangt eine ausdrückliche Freigabe; die übrigen Browser nicht. */
interface IosDeviceMotionEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

function motionApi(): IosDeviceMotionEvent | null {
  if (typeof DeviceMotionEvent === 'undefined') return null
  return DeviceMotionEvent as unknown as IosDeviceMotionEvent
}

export function needsMotionPermission(): boolean {
  return typeof motionApi()?.requestPermission === 'function'
}

/**
 * Zugriff auf den Beschleunigungssensor.
 *
 * `request()` **muss** aus einer echten Nutzergeste heraus aufgerufen werden — ruft
 * man es aus einem Effect heraus auf, lehnt iOS ohne Rückfrage ab. Im Onboarding
 * hängt es deshalb an einem eigenen Knopf und nicht am Seitenaufbau.
 */
export function useMotionPermission(): {
  permission: MotionPermission
  request: () => Promise<MotionPermission>
} {
  const [permission, setPermission] = useState<MotionPermission>(() => {
    if (!motionApi()) return 'unsupported'
    return needsMotionPermission() ? 'prompt' : 'granted'
  })

  const request = useCallback(async (): Promise<MotionPermission> => {
    const api = motionApi()
    if (!api) {
      setPermission('unsupported')
      return 'unsupported'
    }
    if (typeof api.requestPermission !== 'function') {
      setPermission('granted')
      return 'granted'
    }

    try {
      const result = await api.requestPermission()
      const next: MotionPermission = result === 'granted' ? 'granted' : 'denied'
      setPermission(next)
      return next
    } catch {
      setPermission('denied')
      return 'denied'
    }
  }, [])

  return { permission, request }
}

/**
 * Speist die Messwerte des Sensors an einen Rückruf.
 *
 * Der Zeitstempel kommt aus `event.timeStamp` plus `performance.timeOrigin` statt
 * aus `Date.now()`: Ersterer wird gesetzt, wenn das Ereignis entsteht, letzterer
 * erst, wenn der Handler drankommt — unter Last liegen dazwischen leicht einige
 * zehn Millisekunden, und genau diese Zeitspanne vergleicht der Server später.
 *
 * Der Rückruf liegt in einem Ref, damit ein neu erzeugter Handler den Listener nicht
 * bei jedem Rendern ab- und wieder anmeldet — das würde die Filterhistorie verwerfen.
 */
export function useMotionStream(
  enabled: boolean,
  onSample: (sample: MotionSample) => void,
): { receiving: boolean } {
  const [receiving, setReceiving] = useState(false)
  const handlerRef = useRef(onSample)
  handlerRef.current = onSample

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
      setReceiving(false)
      return
    }

    let sawSample = false

    const listener = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity
      if (!acceleration || acceleration.x === null) return

      if (!sawSample) {
        sawSample = true
        setReceiving(true)
      }

      handlerRef.current({
        t: performance.timeOrigin + event.timeStamp,
        x: acceleration.x ?? 0,
        y: acceleration.y ?? 0,
        z: acceleration.z ?? 0,
      })
    }

    window.addEventListener('devicemotion', listener)
    return () => {
      window.removeEventListener('devicemotion', listener)
      setReceiving(false)
    }
  }, [enabled])

  return { receiving }
}
