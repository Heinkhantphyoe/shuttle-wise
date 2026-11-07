import { GoogleAuthProvider, signInWithPopup, signOut, type Auth, type User } from 'firebase/auth'
import { doc, onSnapshot, type Firestore } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { guidance } from './ai'
import { watchHistory, watchQueue, type HistoryEvent } from './live'
import { routeIds, routes, serviceDay, type RouteId } from './schedule'
import { historyCutoff, summarize, syntheticTimes, type Trend } from './trends'

export function Admin({ auth, db, user }: { auth: Auth; db: Firestore; user?: User | null }) {
  const [allowed, setAllowed] = useState<boolean>()
  const [error, setError] = useState('')
  useEffect(() => {
    setAllowed(undefined)
    if (!user) return
    let current = true
    let unsubscribe: (() => void) | undefined
    void user.getIdTokenResult().then(result => {
      if (!current) return
      if (result.signInProvider !== 'google.com') { setAllowed(false); return }
      unsubscribe = onSnapshot(doc(db, 'admins', user.uid), { includeMetadataChanges: true }, snapshot => {
        setAllowed(!snapshot.metadata.fromCache && snapshot.exists())
      }, () => setAllowed(false))
    }).catch(() => { if (current) setAllowed(false) })
    return () => { current = false; unsubscribe?.() }
  }, [db, user])

  return <section className="content">
    <h1>Admin dashboard</h1>
    {error && <p role="alert" className="notice">{error}</p>}
    {user && allowed ? <>
      <button className="secondary" onClick={() => void signOut(auth).catch(() => setError('Sign-out failed.'))}>Sign out</button>
      <Dashboard key={user.uid} db={db} user={user} />
    </> : <>
      <p>{user && allowed === undefined ? 'Checking admin access…' : 'Sign in with an allowlisted Google account.'}</p>
      <button onClick={() => {
        setError('')
        void signInWithPopup(auth, new GoogleAuthProvider()).catch(() => setError('Google sign-in failed. Try again.'))
      }}>Sign in with Google</button>
      {user?.providerData.some(provider => provider.providerId === 'google.com') && allowed === false &&
        <p className="notice">This account does not have access to the dashboard.</p>}
    </>}
  </section>
}

function Dashboard({ db, user }: { db: Firestore; user: User }) {
  const [now, setNow] = useState(Date.now)
  const [counts, setCounts] = useState<Partial<Record<RouteId, number>>>({})
  const [history, setHistory] = useState<HistoryEvent[]>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [briefing, setBriefing] = useState<{ input: string; text: string }>()
  const day = serviceDay(now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const subscriptions = routeIds.map(route => watchQueue(db, route, entries => {
      setCounts(previous => ({ ...previous, [route]: entries.length }))
    }, () => {
      setCounts(previous => ({ ...previous, [route]: undefined }))
      setError('A live queue could not be loaded.')
    }))
    return () => subscriptions.forEach(unsubscribe => unsubscribe())
  }, [db])
  useEffect(() => {
    setHistory(undefined)
    const startOfDay = day * 86_400_000 - 8 * 3_600_000
    return watchHistory(db, historyCutoff(startOfDay), setHistory, () => {
      setHistory(undefined)
      setError('Live history could not be loaded.')
    })
  }, [db, day])

  const liveTrend = (route: RouteId) => summarize(history?.filter(event => event.route === route)
    .map(event => event.joinedAt.toMillis()) ?? [], now)
  const apu = liveTrend('apu')
  const lrt = liveTrend('lrt')
  const metrics = { apu: apu.metrics, lrt: lrt.metrics }
  const input = JSON.stringify(metrics)
  return <>
    {error && <p role="alert" className="notice">{error}</p>}
    <div className="columns">{routeIds.map(route => <section className="card" key={route}>
      <h2>{routes[route].origin} → {routes[route].destination}</h2>
      <p>{counts[route] === undefined ? 'Live queue unavailable' : `${counts[route]} students currently checked in`}</p>
    </section>)}</div>
    <h2>Live check-in history</h2>
    <p>Malaysia time. The current period includes today and the preceding six days.</p>
    {history ? <>
      <div className="columns">
        <TrendCard route="apu" trend={apu} />
        <TrendCard route="lrt" trend={lrt} />
      </div>
      <section className="card">
        <h2>Admin briefing</h2>
        {briefing?.input === input && <p role="status">{briefing.text}</p>}
        <button disabled={loading} onClick={async () => {
          setLoading(true)
          try {
            const text = await guidance({ kind: 'briefing', metrics }, user)
            setBriefing({ input, text: text ?? 'AI briefing unavailable. The computed summary is shown above.' })
          } catch {
            setBriefing({ input, text: 'AI briefing unavailable. The computed summary is shown above.' })
          } finally { setLoading(false) }
        }}>{loading ? 'Preparing briefing…' : 'Generate briefing'}</button>
      </section>
    </> : <p className="notice">Live history is unavailable.</p>}
    <h2>Synthetic demo history</h2>
    <p>Illustrative check-ins. Live totals and briefings exclude these samples.</p>
    <div className="columns">{routeIds.map(route =>
      <TrendCard key={route} route={route} trend={summarize(syntheticTimes(now, route === 'apu'), now)} />)}</div>
  </>
}

function TrendCard({ route, trend }: { route: RouteId; trend: Trend }) {
  const { current, previous, peakHour, peakCount } = trend.metrics
  const peak = String(peakHour).padStart(2, '0') + ':00'
  const difference = current - previous
  const max = Math.max(...trend.daily, 1)
  return <section className="card">
    <h3>{routes[route].origin} → {routes[route].destination}</h3>
    <p>{current} check-ins in the current period · {previous} in the previous period</p>
    <p>{difference === 0 ? 'No change in volume' : `${Math.abs(difference)} ${difference > 0 ? 'more' : 'fewer'} check-ins`}</p>
    <p>{peakHour < 0 ? 'No current peak' : `Peak hour starts at ${peak} · ${peakCount} check-ins`}</p>
    <div className="chart" role="img" aria-label={`Daily check-ins, oldest to newest: ${trend.daily.join(', ')}`}>
      {trend.daily.map((count, index) => <span key={index} className={index < 7 ? 'previous' : ''}
        title={String(count)} style={{ height: `${Math.max(3, count / max * 100)}%` }} />)}
    </div>
  </section>
}
