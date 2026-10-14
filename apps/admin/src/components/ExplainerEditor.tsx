import { EXPLAINER_TEXT_MAX, EXPLAINER_TITLE_MAX, type ExplainerStep } from '@comatch/core'
import { useEffect, useRef, useState } from 'react'
import { resolveMediaUrl } from '../api.js'
import type { EventTexts } from '../eventTexts.js'

type Draft = Array<{ title: string; text: string }>

const toDraft = (steps: readonly ExplainerStep[]): Draft =>
  steps.map(({ title, text }) => ({ title, text }))

// Der Server kürzt Leerraum — ohne denselben Vergleich bliebe nach dem Speichern „ungespeichert" stehen.
const sameDraft = (a: Draft, b: Draft): boolean =>
  a.length === b.length &&
  a.every(
    (step, i) => step.title.trim() === b[i]!.title.trim() && step.text.trim() === b[i]!.text.trim(),
  )

/**
 * Die Spielerklärung bearbeiten: je Schritt Titel, Bild und Text.
 *
 * Bilder gehen sofort beim Auswählen hoch, die Texte erst mit „Speichern" — neun
 * Felder bei jedem Tastendruck zu speichern, hieße Dutzende Anfragen je Satz.
 */
export function ExplainerEditor({
  steps,
  busy,
  texts,
  onSave,
  onUpload,
  onRemoveImage,
}: {
  steps: ExplainerStep[]
  busy: boolean
  texts: EventTexts
  onSave: (draft: Draft) => Promise<boolean>
  onUpload: (position: number, file: File) => Promise<boolean>
  onRemoveImage: (position: number) => Promise<boolean>
}): React.ReactElement {
  const t = texts.explainer
  const saved = toDraft(steps)
  const [draft, setDraft] = useState<Draft>(saved)
  const [base, setBase] = useState<Draft>(saved)
  const dirty = !sameDraft(draft, base)

  /*
   * Die Eventseite pollt: Kommt ein neuer Stand vom Server (etwa aus einem zweiten
   * Tab), übernimmt ihn der Editor — aber nie über ungespeicherte Eingaben hinweg.
   */
  const savedKey = JSON.stringify(saved)
  const baseRef = useRef(base)
  useEffect(() => {
    const next = JSON.parse(savedKey) as Draft
    const previous = baseRef.current
    baseRef.current = next
    setBase(next)
    setDraft((current) => (sameDraft(current, previous) ? next : current))
  }, [savedKey])

  const update = (position: number, field: 'title' | 'text', value: string) =>
    setDraft((current) =>
      current.map((step, i) => (i === position ? { ...step, [field]: value } : step)),
    )

  return (
    <div className="card stack">
      <p className="card__title">{t.title}</p>
      <p className="small muted">{t.hint}</p>

      <div className="explainer-editor">
        {steps.map((step, position) => (
          <div key={position} className="explainer-editor__step stack">
            <p className="small muted">{t.step(position + 1)}</p>
            <div className="field">
              <label htmlFor={`explainer-title-${position}`}>{t.titleLabel}</label>
              <input
                id={`explainer-title-${position}`}
                className="input"
                maxLength={EXPLAINER_TITLE_MAX}
                value={draft[position]?.title ?? ''}
                onChange={(change) => update(position, 'title', change.target.value)}
              />
            </div>
            <StepImage
              url={step.imageUrl}
              busy={busy}
              texts={texts}
              onUpload={(file) => void onUpload(position, file)}
              onRemove={() => void onRemoveImage(position)}
            />
            <div className="field">
              <label htmlFor={`explainer-text-${position}`}>{t.textLabel}</label>
              <textarea
                id={`explainer-text-${position}`}
                className="input input--area"
                rows={4}
                maxLength={EXPLAINER_TEXT_MAX}
                value={draft[position]?.text ?? ''}
                onChange={(change) => update(position, 'text', change.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="row">
        <button className="btn" disabled={busy || !dirty} onClick={() => void onSave(draft)}>
          {t.save}
        </button>
        <span className="small muted">{dirty ? t.unsaved : t.saved}</span>
        <span className="small muted" style={{ marginLeft: 'auto' }}>
          {t.imageHint}
        </span>
      </div>
    </div>
  )
}

function StepImage({
  url,
  busy,
  texts,
  onUpload,
  onRemove,
}: {
  url: string | null
  busy: boolean
  texts: EventTexts
  onUpload: (file: File) => void
  onRemove: () => void
}): React.ReactElement {
  const t = texts.explainer
  const fileInput = useRef<HTMLInputElement>(null)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="explainer-editor__image">
        {url && <img src={resolveMediaUrl(url) ?? ''} alt="" />}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(change) => {
          const file = change.target.files?.[0]
          if (file) onUpload(file)
          // Dieselbe Datei noch einmal wählen soll wieder ein Ereignis auslösen.
          change.target.value = ''
        }}
      />

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {url ? t.imageReplace : t.imageUpload}
        </button>
        {url &&
          (confirming ? (
            <button
              className="btn btn--danger btn--sm"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                onRemove()
              }}
              onBlur={() => setConfirming(false)}
            >
              {t.imageRemoveConfirm}
            </button>
          ) : (
            <button
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              {t.imageRemove}
            </button>
          ))}
      </div>
    </div>
  )
}
