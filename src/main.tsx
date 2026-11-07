import { createRoot } from 'react-dom/client'
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth'
import { useEffect, useRef, useState } from 'react'
import { adminPage, auth, db } from './firebase'
import { Student } from './student'
import { Admin } from './admin'
import './style.css'
import './route-picker.css'

function ViewSwitcher() {
  const switcher = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      const details = switcher.current
      if (details?.open && !details.contains(event.target as Node)) details.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])

  return <details ref={switcher} className="profile-switcher" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
  }} onKeyDown={event => {
    if (event.key === 'Escape' && event.currentTarget.open) {
      event.currentTarget.querySelector('summary')?.focus()
      event.currentTarget.open = false
    }
  }}>
    <summary aria-label="Switch between Student and Admin">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="10" r="3" />
        <path d="M6 18a6 6 0 0 1 12 0" />
      </svg>
    </summary>
    <div className="profile-links">
      <a href="/" aria-current={!adminPage ? 'page' : undefined}>Student</a>
      <a href="/admin" aria-current={adminPage ? 'page' : undefined}>Admin</a>
    </div>
  </details>
}

function App() {
  const [user, setUser] = useState<User | null>()
  const [authError, setAuthError] = useState('')
  useEffect(() => {
    const sessionAuth = auth
    if (!sessionAuth) return
    return onAuthStateChanged(sessionAuth, current => {
      setUser(current)
      if (!adminPage && !current) {
        void signInAnonymously(sessionAuth).catch(() => setAuthError('Could not start a student session. Reload to retry.'))
      }
    }, () => setAuthError('Could not connect to Firebase Auth.'))
  }, [])

  return <main className={adminPage ? 'app admin' : 'app'}>
    <header className="brand">
      <span className="logo" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="3" width="14" height="15" rx="3" />
          <path d="M5 11h14M8 14h1m6 0h1M8 18v3m8-3v3M9 6h6" />
        </svg>
      </span>
      <div><strong>ShuttleWise</strong><small>APU campus shuttle</small></div>
      <ViewSwitcher />
    </header>
    {authError && <p className="notice" role="alert">{authError}</p>}
    {adminPage
      ? auth && db ? <Admin auth={auth} db={db} user={user} /> : <section className="content"><h1>Admin dashboard</h1><p>Firebase is unconfigured.</p></section>
      : <Student db={db} user={user ?? undefined} />}
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
