import type { ParticipantProfile } from '@comatch/core'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, resolveMediaUrl, setSessionToken } from '../api.js'
import { CalibrationStep } from '../components/CalibrationStep.js'
import { describeError, useT } from '../i18n/I18nProvider.js'
import { loadSession, saveSession } from '../session.js'

type Step = 'name' | 'photo' | 'profile' | 'sensor'

/**
 * Onboarding: Vorname → Selfie → optionales Profil → Sensor.
 *
 * In dieser Reihenfolge, weil jeder Schritt die Hürde für den nächsten senkt. Nach
 * dem Foto ist man bereits im Spiel — Profil und Sensor sind Kür und lassen sich
 * überspringen, ohne dass jemand draußen bleibt.
 */
export function Join(): React.ReactElement {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const t = useT()

  const [step, setStep] = useState<Step>('name')
  const [displayName, setDisplayName] = useState('')
  const [profile, setProfile] = useState<ParticipantProfile>({})
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Eine bestehende Session wieder aufgreifen, statt eine zweite anzulegen.
  useEffect(() => {
    const existing = loadSession(slug)
    if (existing) setSessionToken(existing.token)
  }, [slug])

  // Die Vorschau ist eine Objekt-URL und muss wieder freigegeben werden.
  useEffect(() => {
    return () => {
      if (photoPreview?.startsWith('blob:')) URL.revokeObjectURL(photoPreview)
    }
  }, [photoPreview])

  async function submitName(): Promise<void> {
    const name = displayName.trim()
    if (!name) return

    setBusy(true)
    setError(null)
    try {
      const existing = loadSession(slug)
      if (existing) {
        setSessionToken(existing.token)
        await api.updateMe({ displayName: name })
      } else {
        const result = await api.joinEvent(slug, { displayName: name })
        setSessionToken(result.sessionToken)
        saveSession(slug, {
          token: result.sessionToken,
          participantId: result.participant.id,
        })
      }
      setStep('photo')
    } catch (cause) {
      setError(describeError(t, cause, t.errors.unknown))
    } finally {
      setBusy(false)
    }
  }

  async function uploadPhoto(file: File): Promise<void> {
    setBusy(true)
    setError(null)
    setPhotoPreview(URL.createObjectURL(file))

    try {
      const form = new FormData()
      form.append('photo', file)
      const result = await api.uploadPhoto(form)
      setPhotoPreview(resolveMediaUrl(result.photoUrl))
      setStep('profile')
    } catch (cause) {
      setPhotoPreview(null)
      setError(describeError(t, cause, t.join.photoFailed))
    } finally {
      setBusy(false)
    }
  }

  async function saveProfile(): Promise<void> {
    const filled = Object.fromEntries(
      Object.entries(profile).filter(([, value]) => value?.trim()),
    )

    setBusy(true)
    try {
      if (Object.keys(filled).length > 0) await api.updateMe({ profile: filled })
      setStep('sensor')
    } catch {
      // Das Profil ist freiwillig — daran soll niemand hängenbleiben.
      setStep('sensor')
    } finally {
      setBusy(false)
    }
  }

  async function finish(threshold: number | null): Promise<void> {
    if (threshold !== null) {
      // Nur zur Auswertung: Wie gut trägt die Bump-Erkennung über die Geräte hinweg?
      await api.updateMe({ bumpThreshold: threshold }).catch(() => undefined)
    }
    navigate(`/e/${slug}/play`, { replace: true })
  }

  return (
    <main className="screen">
      <StepDots step={step} />

      {error && <p className="notice notice--error">{error}</p>}

      {step === 'name' && (
        <>
          <div className="stack">
            <h1>{t.join.nameTitle}</h1>
            <p className="muted">{t.join.nameHint}</p>
          </div>
          <div className="spacer" />
          <div className="stack">
            <div className="field">
              <label htmlFor="name">{t.join.nameLabel}</label>
              <input
                id="name"
                className="input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="given-name"
                autoCapitalize="words"
                enterKeyHint="next"
                maxLength={40}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitName()
                }}
              />
            </div>
            <button
              className="btn btn--block"
              disabled={busy || !displayName.trim()}
              onClick={() => void submitName()}
            >
              {t.common.continue}
            </button>
          </div>
        </>
      )}

      {step === 'photo' && (
        <>
          <div className="stack">
            <h1>{t.join.photoTitle}</h1>
            <p className="muted">{t.join.photoHint}</p>
          </div>

          <div className="spacer" />

          {photoPreview && (
            <img
              className="avatar"
              src={photoPreview}
              alt={t.join.photoAlt}
              style={{ maxHeight: 320 }}
            />
          )}

          <div className="stack">
            <p className="small muted">{t.join.photoPrivacy}</p>
            {/*
              Die native Kamera-Oberfläche über ein Datei-Feld statt getUserMedia: keine
              zusätzliche Berechtigung, vertraute Bedienung, und auf iOS deutlich
              zuverlässiger als eine selbstgebaute Kameraansicht.
            */}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="user"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadPhoto(file)
              }}
            />
            <button
              className="btn btn--block"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? t.join.photoUploading : photoPreview ? t.join.photoRetake : t.join.photoTake}
            </button>
          </div>
        </>
      )}

      {step === 'profile' && (
        <>
          <div className="stack">
            <h1>{t.join.profileTitle}</h1>
            <p className="muted">{t.join.profileHint}</p>
          </div>

          <div className="spacer" />

          <div className="stack">
            <div className="field">
              <label htmlFor="company">{t.join.company}</label>
              <input
                id="company"
                className="input"
                value={profile.company ?? ''}
                onChange={(event) => setProfile((p) => ({ ...p, company: event.target.value }))}
                maxLength={80}
              />
            </div>
            <div className="field">
              <label htmlFor="role">{t.join.role}</label>
              <input
                id="role"
                className="input"
                value={profile.role ?? ''}
                onChange={(event) => setProfile((p) => ({ ...p, role: event.target.value }))}
                maxLength={80}
              />
            </div>
            <button className="btn btn--block" disabled={busy} onClick={() => void saveProfile()}>
              {t.common.continue}
            </button>
            <button className="btn btn--quiet" onClick={() => setStep('sensor')}>
              {t.common.skip}
            </button>
          </div>
        </>
      )}

      {step === 'sensor' && (
        <>
          <div className="spacer" />
          <CalibrationStep onDone={(threshold) => void finish(threshold)} />
        </>
      )}
    </main>
  )
}

function StepDots({ step }: { step: Step }): React.ReactElement {
  const t = useT()
  const steps: Step[] = ['name', 'photo', 'profile', 'sensor']
  const current = steps.indexOf(step)

  return (
    <div className="row" style={{ gap: 6 }} aria-label={t.join.stepOf(current + 1, steps.length)}>
      {steps.map((name, index) => (
        <span
          key={name}
          style={{
            flex: 1,
            height: 3,
            borderRadius: 2,
            background: index <= current ? 'var(--accent)' : 'var(--border)',
            transition: 'background 0.3s ease',
          }}
        />
      ))}
    </div>
  )
}
