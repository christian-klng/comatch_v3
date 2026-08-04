import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { clearSession } from '../session.js'

/**
 * Das Auskunfts- und Löschrecht in Bedienform.
 *
 * Ein Absatz im Datenschutzhinweis reicht nicht — wer sein Foto weghaben will, muss
 * es hier und jetzt löschen können, ohne eine E-Mail zu schreiben. Deshalb steht der
 * Weg auf jedem Wartebildschirm, aber zurückhaltend genug, um nicht vom Spiel abzulenken.
 */
export function PrivacyFooter(): React.ReactElement {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function remove(): Promise<void> {
    setBusy(true)
    try {
      await api.deleteMe()
    } catch {
      // Auch wenn der Aufruf scheitert: Die Session hier zu behalten hilft niemandem.
    } finally {
      clearSession(slug)
      navigate(`/e/${slug}`, { replace: true })
    }
  }

  if (!confirming) {
    return (
      <button className="btn btn--quiet" onClick={() => setConfirming(true)}>
        Meine Daten löschen
      </button>
    )
  }

  return (
    <div className="notice stack" style={{ textAlign: 'left' }}>
      <p className="small">
        Foto, Vorname und Profil werden sofort gelöscht, und du bist aus dem Spiel raus. Deine
        bisherigen Begegnungen bleiben als Zahl in der Auswertung — ohne Bezug zu dir.
      </p>
      <div className="row">
        <button className="btn btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>
          Abbrechen
        </button>
        <button className="btn" disabled={busy} onClick={() => void remove()}>
          {busy ? 'Wird gelöscht…' : 'Löschen'}
        </button>
      </div>
    </div>
  )
}
