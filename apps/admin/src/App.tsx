import type { AdminAccount } from '@comatch/core'
import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { api } from './api.js'
import { EventDetail } from './pages/EventDetail.js'
import { Events } from './pages/Events.js'
import { Login } from './pages/Login.js'

export function App(): React.ReactElement {
  const [admin, setAdmin] = useState<AdminAccount | null>(null)
  const [checking, setChecking] = useState(true)

  // Beim Start prüfen, ob das Cookie noch gilt — sonst müsste man sich nach jedem
  // Reload neu anmelden, mitten im Event ein echtes Ärgernis.
  useEffect(() => {
    api
      .admin.me()
      .then((result) => setAdmin(result.admin))
      .catch(() => setAdmin(null))
      .finally(() => setChecking(false))
  }, [])

  if (checking) {
    return (
      <div className="page">
        <p className="muted">Einen Moment…</p>
      </div>
    )
  }

  if (!admin) return <Login onSignedIn={setAdmin} />

  return (
    <BrowserRouter>
      <Shell admin={admin} onSignedOut={() => setAdmin(null)}>
        <Routes>
          <Route path="/" element={<Events />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  )
}

function Shell({
  admin,
  onSignedOut,
  children,
}: {
  admin: AdminAccount
  onSignedOut: () => void
  children: React.ReactNode
}): React.ReactElement {
  const navigate = useNavigate()

  const signOut = useCallback(async () => {
    await api.admin.logout().catch(() => undefined)
    onSignedOut()
    navigate('/')
  }, [navigate, onSignedOut])

  return (
    <div className="page">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => navigate('/')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <Logo />
          CoMatch Admin
        </button>
        <div className="row">
          <span className="small muted">{admin.email}</span>
          <button className="btn btn--ghost" onClick={() => void signOut()}>
            Abmelden
          </button>
        </div>
      </header>
      {children}
    </div>
  )
}

function Logo(): React.ReactElement {
  return (
    <svg width="26" height="26" viewBox="0 0 512 512" aria-hidden="true">
      <circle cx="196" cy="256" r="96" fill="none" stroke="#5b8cff" strokeWidth="40" />
      <circle cx="316" cy="256" r="96" fill="none" stroke="#38d39f" strokeWidth="40" />
    </svg>
  )
}
