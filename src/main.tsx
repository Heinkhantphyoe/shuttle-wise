import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth'
import { useEffect, useRef, useState } from 'react'
import { adminPage, auth, db } from './firebase'
import { temporaryPickup } from './config'
import { Student } from './student'
import { Admin } from './admin'
import './style.css'
import './route-picker.css'
import './student.css'

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.studentTheme === 'dark')
  const requestedDark = useRef(dark)

  function toggleTheme() {
    const nextDark = !requestedDark.current
    requestedDark.current = nextDark
    const nextTheme = nextDark ? 'dark' : 'light'
    try { localStorage.setItem('shuttlewise-theme', nextTheme) } catch {}

    function applyTheme() {
      if (requestedDark.current !== nextDark) return
      document.documentElement.dataset.studentTheme = nextTheme
      setDark(nextDark)
    }

    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(() => flushSync(applyTheme))
    } else {
      applyTheme()
    }
  }

  return <button type="button" className="theme-toggle" aria-label="Dark mode" aria-pressed={dark} onClick={toggleTheme}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dark ? <path d="M20.9 13.3A9 9 0 0 1 10.7 3.1 9 9 0 1 0 20.9 13.3Z" />
        : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>}
    </svg>
  </button>
}

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
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="none" fill="currentColor" opacity=".18" />
        <circle cx="12" cy="9" r="2.6" stroke="none" fill="currentColor" />
        <path d="M7.25 16.75v-.5a4.75 4.75 0 0 1 9.5 0v.5a.75.75 0 0 1-.75.75H8a.75.75 0 0 1-.75-.75Z"
          stroke="none" fill="currentColor" />
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

  return <main className={adminPage ? 'app admin' : 'app student-app'}>
    <header className="brand">
      <span className="logo" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="3" width="14" height="15" rx="3" />
          <path d="M5 11h14M8 14h1m6 0h1M8 18v3m8-3v3M9 6h6" />
        </svg>
      </span>
      <div><strong>ShuttleWise</strong><small>APU campus shuttle</small></div>
      {adminPage ? <ViewSwitcher /> : <div className="brand-controls">
        <ThemeToggle />
        <ViewSwitcher />
      </div>}
    </header>
    {temporaryPickup && <aside className="notice testing-notice">
      <strong>Temporary testing · {temporaryPickup}</strong>
      <p>Both routes use this check-in location. Sample students and rides may appear.</p>
    </aside>}
    {authError && <p className="notice" role="alert">{authError}</p>}
    {adminPage
      ? auth && db ? <Admin auth={auth} db={db} user={user} /> : <section className="content"><h1>Admin dashboard</h1><p>Firebase is unconfigured.</p></section>
      : <Student db={db} user={user ?? undefined} />}
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
