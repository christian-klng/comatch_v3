import {
  CORNER_CHOICES,
  DESIGN_PRESETS,
  DESIGN_PRESET_IDS,
  FONT_CHOICES,
  HEX_PATTERN,
  isSameDesign,
  type DesignTemplate,
  type EventDesign as Design,
  type EventSummary,
  type Theme,
  type ThemeAdjustment,
} from '@comatch/core'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { describeError, eventTexts, pendingEventTexts, type EventTexts } from '../eventTexts.js'
import { EventLogo, themeStyle, useTheme } from '../theme.js'

/**
 * Der Design-Editor eines Events.
 *
 * Bearbeitet wird ein Entwurf; erst „Speichern" schickt ihn an Handys und Leinwand —
 * sonst sähe der Saal jedem Schieben am Farbregler zu. Die Vorschau rechnet mit
 * derselben Ableitung wie die echten Oberflächen, zeigt also auch jede Korrektur, die
 * die Leitplanken an einer unlesbaren Eingabe vornehmen.
 */
export function EventDesign(): React.ReactElement {
  const { id = '' } = useParams()
  const [event, setEvent] = useState<EventSummary | null>(null)
  const [templates, setTemplates] = useState<DesignTemplate[]>([])
  /** `null` ist das Comatch-Standarddesign. */
  const [draft, setDraft] = useState<Design | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    Promise.all([api.admin.getEvent(id), api.admin.listDesignTemplates()])
      .then(([detail, list]) => {
        if (cancelled) return
        setEvent(detail.event)
        setDraft(detail.event.design)
        setTemplates(list.templates)
      })
      .catch(() => {
        if (!cancelled) setError(pendingEventTexts(true).loadFailed)
      })

    return () => {
      cancelled = true
    }
  }, [id])

  const theme = useTheme(draft)
  const texts = event ? eventTexts(event.locale) : pendingEventTexts(true)

  if (!event) {
    if (error) return <p className="notice notice--error">{error}</p>
    return <p className="muted">{texts.loading}</p>
  }

  const t = texts.design
  const dirty = !isSameDesign(draft, event.design)

  /** Eine Aktion mit Sperre und Fehlermeldung. */
  async function run(action: () => Promise<void>, failure: string): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (cause) {
      setError(describeError(texts, cause, failure))
    } finally {
      setBusy(false)
    }
  }

  /** Wer am Standarddesign dreht, startet von dessen Farben aus. */
  const change = (patch: Partial<Design>) =>
    setDraft((current) => ({ ...(current ?? DESIGN_PRESETS.midnight), ...patch }))

  const save = () =>
    run(async () => {
      const result = await api.admin.updateEvent(id, { design: draft })
      setEvent(result.event)
      setDraft(result.event.design)
      setNotice(t.saved)
    }, texts.failures.saveDesign)

  const uploadLogo = (file: File) =>
    run(async () => {
      const form = new FormData()
      form.append('logo', file)
      setEvent((await api.admin.uploadEventLogo(id, form)).event)
    }, texts.failures.uploadLogo)

  const removeLogo = () =>
    run(async () => {
      setEvent((await api.admin.removeEventLogo(id)).event)
    }, texts.failures.generic)

  const saveTemplate = (name: string, design: Design) =>
    run(async () => {
      const existing = findTemplate(templates, name)
      const { template } = existing
        ? await api.admin.updateDesignTemplate(existing.id, { design })
        : await api.admin.createDesignTemplate({ name, design })
      setTemplates((current) =>
        [...current.filter((entry) => entry.id !== template.id), template].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      )
      setNotice(t.templateSaved)
    }, texts.failures.saveTemplate)

  const deleteTemplate = (templateId: string) =>
    run(async () => {
      await api.admin.deleteDesignTemplate(templateId)
      setTemplates((current) => current.filter((entry) => entry.id !== templateId))
    }, texts.failures.generic)

  const adjustmentFor = (input: ThemeAdjustment['input']) =>
    theme?.adjustments.find((entry) => entry.input === input)

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <Link className="small" to={`/events/${event.id}`}>
            ← {t.back}
          </Link>
          <h1>
            {t.title} · {event.name}
          </h1>
        </div>
        <div className="row">
          {dirty && <span className="badge badge--warn">{t.unsaved}</span>}
          {dirty && (
            <button
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => setDraft(event.design)}
            >
              {t.discard}
            </button>
          )}
          <button className="btn" disabled={busy || !dirty} onClick={() => void save()}>
            {t.save}
          </button>
        </div>
      </div>

      <p className="muted small" style={{ maxWidth: 720 }}>
        {t.intro}
      </p>

      {error && <p className="notice notice--error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className="design-editor">
        <div className="stack">
          <div className="card stack">
            <p className="card__title">{t.presets}</p>
            <div className="swatches">
              <Swatch
                label={t.standard}
                design={null}
                active={draft === null}
                onPick={() => setDraft(null)}
              />
              {DESIGN_PRESET_IDS.map((presetId) => (
                <Swatch
                  key={presetId}
                  label={t.presetNames[presetId]}
                  design={DESIGN_PRESETS[presetId]}
                  active={isSameDesign(draft, DESIGN_PRESETS[presetId])}
                  onPick={() => setDraft(DESIGN_PRESETS[presetId])}
                />
              ))}
            </div>

            {templates.length > 0 && (
              <>
                <p className="card__title">{t.templates}</p>
                <div className="swatches">
                  {templates.map((template) => (
                    <Swatch
                      key={template.id}
                      label={template.name}
                      design={template.design}
                      active={isSameDesign(draft, template.design)}
                      onPick={() => setDraft(template.design)}
                      remove={{
                        label: t.templateDelete,
                        confirm: t.templateDeleteConfirm,
                        busy,
                        onRemove: () => void deleteTemplate(template.id),
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="card stack">
            <ColorField
              id="design-background"
              label={t.background}
              value={(draft ?? DESIGN_PRESETS.midnight).background}
              adjustment={adjustmentFor('background')}
              texts={texts}
              onChange={(background) => change({ background })}
            />
            <ColorField
              id="design-accent"
              label={t.accent}
              hint={t.accentHint}
              value={(draft ?? DESIGN_PRESETS.midnight).accent}
              adjustment={adjustmentFor('accent')}
              texts={texts}
              onChange={(accent) => change({ accent })}
            />
            {theme?.scheme === 'light' && <p className="notice small">{t.darkRoomHint}</p>}

            <div className="field">
              <label>{t.font}</label>
              <Choice
                label={t.font}
                options={FONT_CHOICES}
                names={t.fonts}
                value={(draft ?? DESIGN_PRESETS.midnight).font}
                onChange={(font) => change({ font })}
              />
              <p className="small muted">{t.fontHint}</p>
            </div>

            <div className="field">
              <label>{t.corners}</label>
              <Choice
                label={t.corners}
                options={CORNER_CHOICES}
                names={t.cornerNames}
                value={(draft ?? DESIGN_PRESETS.midnight).corners}
                onChange={(corners) => change({ corners })}
              />
            </div>
          </div>

          <LogoCard
            event={event}
            theme={theme}
            busy={busy}
            texts={texts}
            onUpload={(file) => void uploadLogo(file)}
            onRemove={() => void removeLogo()}
          />

          {draft && (
            <TemplateCard
              templates={templates}
              busy={busy}
              texts={texts}
              onSave={(name) => void saveTemplate(name, draft)}
            />
          )}
        </div>

        <Preview event={event} theme={theme} texts={texts} />
      </div>
    </div>
  )
}

function findTemplate(templates: DesignTemplate[], name: string): DesignTemplate | undefined {
  const wanted = name.trim().toLowerCase()
  return templates.find((template) => template.name.toLowerCase() === wanted)
}

/* ---------------------------------------------------------------- Bausteine */

/** Eine Design-Kachel: Hintergrund, Akzent und Schrift auf einen Blick. */
function Swatch({
  label,
  design,
  active,
  onPick,
  remove,
}: {
  label: string
  design: Design | null
  active: boolean
  onPick: () => void
  remove?: { label: string; confirm: string; busy: boolean; onRemove: () => void }
}): React.ReactElement {
  const theme = useTheme(design)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="swatch-wrap">
      <button
        className={active ? 'swatch swatch--active' : 'swatch'}
        style={themeStyle(theme)}
        aria-pressed={active}
        onClick={onPick}
      >
        <span className="swatch__sample">
          Aa <span className="swatch__dot" />
        </span>
        <span className="swatch__label">{label}</span>
      </button>
      {remove &&
        (confirming ? (
          <button
            className="btn btn--danger btn--sm"
            disabled={remove.busy}
            onClick={remove.onRemove}
            onBlur={() => setConfirming(false)}
          >
            {remove.confirm}
          </button>
        ) : (
          <button className="btn btn--ghost btn--sm" onClick={() => setConfirming(true)}>
            {remove.label}
          </button>
        ))}
    </div>
  )
}

function ColorField({
  id,
  label,
  hint,
  value,
  adjustment,
  texts,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  value: string
  adjustment: ThemeAdjustment | undefined
  texts: EventTexts
  onChange: (value: string) => void
}): React.ReactElement {
  // Solange getippt wird, hält das Textfeld auch halbfertige Eingaben; weitergegeben wird
  // nur eine ganze Farbe. Ohne Fokus zeigt es wieder, was gilt.
  const [typing, setTyping] = useState<string | null>(null)

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {hint && <span className="muted"> · {hint}</span>}
      </label>
      <div className="row">
        <input
          id={id}
          className="color-input"
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
        <input
          className="input mono"
          style={{ width: 120 }}
          value={typing ?? value}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label} (Hex)`}
          onChange={(event) => {
            const next = event.target.value.trim()
            setTyping(next)
            if (HEX_PATTERN.test(next)) onChange(next.toLowerCase())
          }}
          onBlur={() => setTyping(null)}
        />
      </div>
      {adjustment && (
        <p className="notice small adjusted">
          <span>{texts.design.adjusted[adjustment.input]}</span>
          <span className="adjusted__pair">
            <span className="adjusted__chip" style={{ background: adjustment.from }} />
            {texts.design.adjusted.yours}
            <span aria-hidden="true">→</span>
            <span className="adjusted__chip" style={{ background: adjustment.to }} />
            {texts.design.adjusted.used}
          </span>
        </p>
      )}
    </div>
  )
}

function Choice<T extends string>({
  label,
  options,
  names,
  value,
  onChange,
}: {
  label: string
  options: readonly T[]
  names: Record<T, string>
  value: T
  onChange: (value: T) => void
}): React.ReactElement {
  return (
    <div className="segmented" role="group" aria-label={label} style={{ alignSelf: 'flex-start' }}>
      {options.map((option) => (
        <button
          key={option}
          className={
            option === value ? 'segmented__option segmented__option--active' : 'segmented__option'
          }
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {names[option]}
        </button>
      ))}
    </div>
  )
}

function LogoCard({
  event,
  theme,
  busy,
  texts,
  onUpload,
  onRemove,
}: {
  event: EventSummary
  theme: Theme | null
  busy: boolean
  texts: EventTexts
  onUpload: (file: File) => void
  onRemove: () => void
}): React.ReactElement {
  const t = texts.design
  const fileInput = useRef<HTMLInputElement>(null)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="card stack">
      <p className="card__title">{t.logo}</p>

      {event.logo && (
        <div className="design-preview logo-stage" style={themeStyle(theme)}>
          <EventLogo logo={event.logo} scheme={theme?.scheme ?? 'dark'} eventName={event.name} />
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/svg+xml,image/webp,image/jpeg"
        hidden
        onChange={(change) => {
          const file = change.target.files?.[0]
          if (file) onUpload(file)
          // Dieselbe Datei noch einmal wählen soll wieder ein Ereignis auslösen.
          change.target.value = ''
        }}
      />

      <div className="row">
        <button
          className="btn btn--ghost"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {event.logo ? t.logoReplace : t.logoUpload}
        </button>
        {event.logo &&
          (confirming ? (
            <button
              className="btn btn--danger"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                onRemove()
              }}
              onBlur={() => setConfirming(false)}
            >
              {t.logoRemoveConfirm}
            </button>
          ) : (
            <button className="btn btn--ghost" disabled={busy} onClick={() => setConfirming(true)}>
              {t.logoRemove}
            </button>
          ))}
      </div>

      <p className="small muted">{t.logoHint}</p>
      <p className="small muted">{t.logoAppliesNow}</p>
    </div>
  )
}

function TemplateCard({
  templates,
  busy,
  texts,
  onSave,
}: {
  templates: DesignTemplate[]
  busy: boolean
  texts: EventTexts
  onSave: (name: string) => void
}): React.ReactElement {
  const t = texts.design
  const [name, setName] = useState('')
  const existing = name.trim() ? findTemplate(templates, name) : undefined

  return (
    <form
      className="card stack"
      onSubmit={(submit) => {
        submit.preventDefault()
        if (!name.trim()) return
        onSave(name.trim())
        // Sonst spränge der Knopf sofort auf „überschreiben" — für die eben gespeicherte Vorlage.
        setName('')
      }}
    >
      <p className="card__title">{t.saveAsTemplate}</p>
      <div className="stack" style={{ gap: 8 }}>
        <input
          className="input"
          placeholder={t.templateNamePlaceholder}
          aria-label={t.templateName}
          value={name}
          maxLength={60}
          onChange={(change) => setName(change.target.value)}
        />
        <button
          className="btn btn--ghost"
          style={{ alignSelf: 'flex-start' }}
          disabled={busy || !name.trim()}
        >
          {existing ? t.templateOverwrite(existing.name) : t.saveAsTemplate}
        </button>
      </div>
      <p className="small muted">{t.templateCopyHint}</p>
    </form>
  )
}

/* ----------------------------------------------------------------- Vorschau */

/**
 * Handy und Leinwand im Kleinen. Nachgebaut statt eingebettet: Ein iframe auf die
 * Teilnehmer-App bräuchte ein echtes Event mit Teilnehmern, um mehr als die Begrüßung
 * zu zeigen. Die Farben kommen aus denselben CSS-Variablen wie in den echten
 * Oberflächen — was hier lesbar ist, ist es dort auch.
 */
function Preview({
  event,
  theme,
  texts,
}: {
  event: EventSummary
  theme: Theme | null
  texts: EventTexts
}): React.ReactElement {
  const t = texts.design
  const scheme = theme?.scheme ?? 'dark'
  const logo = <EventLogo logo={event.logo} scheme={scheme} eventName={event.name} />

  return (
    <div className="preview-column">
      <p className="card__title">{t.preview}</p>

      <div className="preview-pair">
        <figure className="preview-figure">
          <div className="design-preview phone" style={themeStyle(theme)}>
            {logo}
            <div className="phone__body">
              <p className="phone__eyebrow">{t.sample.welcome}</p>
              <p className="phone__title">{event.name}</p>
              <p className="phone__muted">{t.sample.teaser}</p>
            </div>
            <div className="phone__card">
              <span className="phone__label">{t.sample.nameLabel}</span>
              <span className="phone__input">{t.sample.name}</span>
            </div>
            <span className="phone__btn">{t.sample.join}</span>
            <span className="phone__btn phone__btn--success">{t.sample.found}</span>
          </div>
          <figcaption className="small muted">{t.previewPhone}</figcaption>
        </figure>

        <figure className="preview-figure preview-figure--wide">
          <div className="design-preview beamer" style={themeStyle(theme)}>
            <div className="beamer__head">
              {logo}
              <span className="beamer__title">{event.name}</span>
            </div>
            <div className="beamer__grid">
              <div className="beamer__card">
                <span className="beamer__label">{t.sample.scan}</span>
                <FakeQr />
              </div>
              <div className="beamer__card">
                <span className="beamer__badge">
                  <span className="beamer__dot" />
                  {t.sample.live}
                </span>
                <span className="beamer__h2">{t.sample.running}</span>
                <div className="beamer__stats">
                  <span className="beamer__stat">
                    <b>48</b>
                    {t.sample.participants}
                  </span>
                  <span className="beamer__stat">
                    <b>112</b>
                    {t.sample.matches}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <figcaption className="small muted">{t.previewScreen}</figcaption>
        </figure>
      </div>
    </div>
  )
}

/** Der QR-Code bleibt in jedem Design schwarz auf weiß — sonst scannt ihn nicht jedes Handy. */
function FakeQr(): React.ReactElement {
  const cells =
    '111010111,100010001,101101101,000110100,110101011,001011000,101100101,100010001,111011111'
      .split(',')
      .flatMap((row, y) => [...row].map((cell, x) => ({ x, y, on: cell === '1' })))
      .filter((cell) => cell.on)

  return (
    <svg className="beamer__qr" viewBox="-1 -1 11 11" aria-hidden="true">
      <rect x="-1" y="-1" width="11" height="11" fill="#ffffff" />
      {cells.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x}
          y={cell.y}
          width="1"
          height="1"
          fill="#0b0d13"
        />
      ))}
    </svg>
  )
}
