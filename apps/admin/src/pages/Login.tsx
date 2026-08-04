import { ApiError, type AdminAccount } from '@comatch/core'
import { useState } from 'react'
import { api } from '../api.js'

export function Login({
  onSignedIn,
}: {
  onSignedIn: (admin: AdminAccount) => void
}): React.ReactElement {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const result = await api.admin.login({ email, password })
      onSignedIn(result.admin)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Anmeldung fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page" style={{ maxWidth: 400, paddingTop: 96 }}>
      <form className="card stack" onSubmit={(event) => void submit(event)}>
        <h1>CoMatch Admin</h1>

        {error && <p className="notice notice--error">{error}</p>}

        <div className="field">
          <label htmlFor="email">E-Mail</label>
          <input
            id="email"
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Passwort</label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <button className="btn btn--block" disabled={busy}>
          {busy ? 'Einen Moment…' : 'Anmelden'}
        </button>
      </form>
    </div>
  )
}
