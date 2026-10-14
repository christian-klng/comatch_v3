import type { ExplainerStep } from '@comatch/core'
import { useEffect, useRef, useState } from 'react'
import { resolveMediaUrl } from '../api.js'
import type { EventTexts } from '../eventTexts.js'

/** Ein Schritt zählt, sobald irgendetwas darin steht — leere werden übersprungen. */
export function filledSteps(steps: readonly ExplainerStep[]): ExplainerStep[] {
  return steps.filter((step) => step.title.trim() || step.text.trim() || step.imageUrl)
}

/** Tasten, die ein Presenter-Klicker schickt — je nach Modell Pfeile oder Bild-auf/-ab. */
const FORWARD = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'])
const BACK = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'])

/**
 * Die Spielerklärung als Vollbild auf der Leinwand — wie eine Folie, deren Spalten
 * nacheinander erscheinen. Der erste Schritt steht schon beim Öffnen da; jeder Klick
 * zeigt den nächsten, der Klick nach dem letzten schließt.
 *
 * Noch nicht gezeigte Spalten sind unsichtbar, nehmen aber schon ihren Platz ein:
 * So springt nichts, wenn die nächste dazukommt.
 */
export function ExplainerShow({
  steps,
  texts,
  onClose,
}: {
  steps: ExplainerStep[]
  texts: EventTexts
  onClose: () => void
}): React.ReactElement {
  const [shown, setShown] = useState(1)
  const stage = useRef<HTMLDivElement>(null)

  const forward = () => (shown >= steps.length ? onClose() : setShown(shown + 1))

  // Den Fokus holen: Sonst löste Enter oder Leertaste noch einmal den Knopf darunter aus.
  useEffect(() => stage.current?.focus(), [])

  return (
    <div
      ref={stage}
      className="explainer-show"
      role="dialog"
      aria-modal="true"
      aria-label={texts.explainer.showLabel}
      tabIndex={-1}
      onClick={forward}
      onKeyDown={(event) => {
        if (FORWARD.has(event.key)) forward()
        else if (BACK.has(event.key)) setShown(Math.max(1, shown - 1))
        else if (event.key === 'Escape') onClose()
        else return
        event.preventDefault()
        event.stopPropagation()
      }}
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((step, i) => (
        <div
          key={i}
          className={
            i < shown ? 'explainer-show__step explainer-show__step--in' : 'explainer-show__step'
          }
          aria-hidden={i >= shown}
        >
          <span className="explainer-show__number">{i + 1}</span>
          {step.title && <h2 className="explainer-show__title">{step.title}</h2>}
          {step.imageUrl && (
            <img
              className="explainer-show__image"
              src={resolveMediaUrl(step.imageUrl) ?? ''}
              alt=""
            />
          )}
          {step.text && <p className="explainer-show__text">{step.text}</p>}
        </div>
      ))}
    </div>
  )
}
