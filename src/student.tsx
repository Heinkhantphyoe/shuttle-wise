import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { pickups } from './config'
import { updateActivity, watchActivity, watchQueue, watchRide, watchRides, type Activity, type CheckIn, type Ride, type RideListing, type Row } from './live'
import { confirmPickup } from './pickup'
import { formatTime, formatWeekday, routeIds, routes, scheduleFor, type RouteId } from './schedule'

const tabs = {
  home: { label: 'Home', icon: 'M3 10 12 3l9 7v11h-6v-7H9v7H3z' },
  timetable: { label: 'Timetable', icon: 'M4 5h16v16H4z M4 10h16 M8 2v6 M16 2v6' },
  rides: { label: 'Grab shares', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 21v-2a4 4 0 0 0-2-3.5 M16 3.2a4 4 0 0 1 0 7.6' },
}
type Tab = keyof typeof tabs
type Command = Parameters<typeof updateActivity>[2]
type Session = { db?: Firestore; user?: User }
const money = (sen: number) => `RM ${(sen / 100).toFixed(2)}`
const unavailable = 'Live data is unavailable. Check your connection and reload.'

function RoutePicker({ route, disabled, onChange }: { route: RouteId; disabled: boolean; onChange: (id: RouteId) => void }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const expanded = open && !disabled

  useEffect(() => {
    if (!expanded) return
    const picker = trigger.current?.parentElement
    function dismiss(event: PointerEvent) {
      if (!picker?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [expanded])

  function close() {
    setOpen(false)
    trigger.current?.focus()
  }

  return <div className="route-picker" onKeyDown={event => {
    if (expanded && event.key === 'Escape') close()
  }} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <button type="button" className="route-trigger" ref={trigger} disabled={disabled}
      aria-expanded={expanded} aria-controls="student-route-options" onClick={() => setOpen(!open)}>
      <span className="route-pin"><RouteIcon path="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0" /></span>
      <span className="route-copy"><small>Your route</small><strong>{routes[route].origin} → {routes[route].destination}</strong></span>
      <span className="route-chevron"><RouteIcon path="m6 9 6 6 6-6" /></span>
    </button>
    <div className="route-options" id="student-route-options" role="group" aria-label="Choose your route" hidden={!expanded}>
      {routeIds.map(id => <button key={id} type="button" className="route-option" aria-pressed={id === route} onClick={() => {
        onChange(id)
        close()
      }}>
        <span className="route-copy">{routes[id].origin} → {routes[id].destination}</span>
        {id === route && <RouteIcon path="m5 12 4 4L19 6" />}
      </button>)}
    </div>
  </div>
}

function RouteIcon({ path }: { path: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
}

function fareFrom(value: FormDataEntryValue | null) {
  const fare = Math.round(Number(value) * 100)
  if (!Number.isInteger(fare) || fare < 1 || fare > 1_000_000) throw new Error('Enter a fare from RM 0.01 to RM 10,000.')
  return fare
}

export function Student({ db, user }: Session) {
  const [route, setRoute] = useState<RouteId>('apu')
  const [tab, setTab] = useState<Tab>('home')
  const [now, setNow] = useState(Date.now)
  const [activity, setActivity] = useState<Activity>()
  const [activityReady, setActivityReady] = useState(false)
  const [ride, setRide] = useState<Row<Ride>>()
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    setActivityReady(false)
    setActivity(undefined)
    if (!db || !user) return
    return watchActivity(db, user.uid, value => {
      setActivity(value)
      setActivityReady(true)
    }, () => { setActivityReady(false); setError(unavailable) })
  }, [db, user])
  const rideId = activity?.kind === 'ride' ? activity.rideId : undefined
  useEffect(() => {
    setRide(undefined)
    if (!db || !rideId) return
    return watchRide(db, rideId, setRide, () => setError(unavailable))
  }, [db, rideId])
  const currentRide = ride?.id === rideId ? ride : undefined
  const inRide = !!rideId && (!currentRide || currentRide.status === 'open')

  async function act(action: () => Promise<unknown>, message = '') {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await action()
      setStatus(message)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Please try again.')
    } finally {
      setBusy(false)
      running.current = false
    }
  }

  const send = (command: Command) => {
    if (!db || !user) throw new Error('Firebase is unavailable.')
    return updateActivity(db, user.uid, command)
  }
  const selected = routes[route]
  const routeLabel = `${selected.origin} → ${selected.destination}`
  const point = pickups[route]
  const schedule = scheduleFor(route, now)
  const ready = activityReady && !busy
  const checkInHere = activity?.kind === 'queue' && activity.route === route
  const checkIn = () => act(async () => {
    if (!point) throw new Error('This pickup point is unconfirmed.')
    await confirmPickup(point)
    await send({ type: 'check-in', route })
  }, 'You’re checked in.')

  return <>
    <section className="content student">
      <h1>{tab === 'home' ? 'Campus shuttle' : tabs[tab].label}</h1>
      <RoutePicker key={tab} route={route} disabled={busy} onChange={setRoute} />
      {!db && <p className="notice">Live features are unavailable until Firebase is configured.</p>}
      {error && <p className="notice" role="alert">{error}</p>}
      {status && <p className="notice" role="status">{status}</p>}
      {tab !== 'rides' && <section className="hero">
        <small>{routeLabel} · Malaysia time</small>
        <h2>{schedule.next !== undefined ? formatTime(schedule.next)
          : schedule.today.length ? 'Service has ended for today' : 'No scheduled service today'}</h2>
        {schedule.next !== undefined ? <p>Next scheduled departure</p>
          : <p>Next weekday’s first departure · {formatWeekday(schedule.nextWeekday)} at {formatTime(schedule.nextWeekday)}</p>}
      </section>}
      {tab === 'home' && <>
        <section className="card">
          <h2>{checkInHere ? 'You’re checked in' : 'Waiting at the stop?'}</h2>
          <QueueStatus key={route} route={route} db={db} user={user} checkedIn={checkInHere} />
          {!point && <p>The {selected.origin} pickup coordinates are unconfirmed.</p>}
          {activity?.kind === 'queue'
            ? <div className="actions">
              {checkInHere && <button disabled={!ready} onClick={() => void act(
                () => send({ type: 'board', route, eventId: activity.eventId }),
                'You’re off the queue. Have a good trip!',
              )}>I got the bus</button>}
              <button className="secondary" disabled={!ready} onClick={() => void act(() => send({ type: 'leave' }), 'Queue spot released.')}>
                Leave {checkInHere ? 'queue' : `${routes[activity.route].origin} queue`}
              </button>
            </div>
            : <button disabled={!ready || !point || inRide} onClick={() => void checkIn()}>Allow location &amp; check in</button>}
          {inRide && <p>Manage or leave your current Grab group before checking in.</p>}
        </section>
        <section className="card"><h2>Share a Grab to {selected.destination}</h2><p>Find a group with up to four people.</p>
          <button className="secondary" onClick={() => setTab('rides')}>Find a ride</button>
        </section>
      </>}
      {tab === 'timetable' && <section className="card">
        <h2>{formatWeekday(now)} departures</h2>
        {schedule.today.length ? <ul className="times">{schedule.today.map(time => <li key={time}>
          <time dateTime={new Date(time).toISOString()}>{formatTime(time)}</time>
          <span>{time === schedule.next ? 'Next shuttle' : time < now ? 'Scheduled earlier' : 'Upcoming'}</span>
        </li>)}</ul> : <p>Shuttles run Monday through Friday.</p>}
      </section>}
      {tab === 'rides' && <>
        {inRide && currentRide ? <section className="card">
          <h2>Your Grab group to {routes[currentRide.route].destination}</h2>
          <RideFare fare={currentRide.fare} count={Object.keys(currentRide.members).length} />
          <ul>{Object.entries(currentRide.members).map(([uid, name]) => <li key={uid}>{name}{uid === currentRide.host ? ' · Host' : ''}</li>)}</ul>
          {currentRide.host === user?.uid ? <>
            <form key={currentRide.fare} onSubmit={event => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              void act(() => send({ type: 'fare', fare: fareFrom(data.get('fare')) }), 'Fare updated.')
            }}>
              <label>New total fare (RM)<input name="fare" type="number" min=".01" max="10000" step=".01" required defaultValue={(currentRide.fare / 100).toFixed(2)} /></label>
              <button className="secondary" disabled={!ready}>Save fare</button>
            </form>
            <div className="actions">
              <button disabled={!ready} onClick={() => void act(() => send({ type: 'close', status: 'departed' }), 'Ride marked as departed.')}>We have departed</button>
              <button className="secondary" disabled={!ready} onClick={() => {
                if (confirm('Cancel this ride for everyone?')) void act(() => send({ type: 'close', status: 'cancelled' }), 'Ride cancelled.')
              }}>Cancel ride</button>
            </div>
          </> : <button className="secondary" disabled={!ready} onClick={() => void act(() => send({ type: 'leave' }), 'You left the ride.')}>Leave ride</button>}
        </section> : <>
          {currentRide && <p className="notice">{currentRide.status === 'departed' ? 'Your group marked this ride as departed.' : 'The host cancelled your ride.'}</p>}
          <RideList key={route} route={route} db={db} user={user} canJoin={ready && checkInHere} join={(rideId, name) => {
            if (confirm('Leave your shuttle queue and join this ride?')) {
              void act(() => send({ type: 'join', route, rideId, name }), 'You joined the ride.')
            }
          }} />
          <section className="card">
            <h2>Host a ride</h2>
            <p>Check in at this pickup before hosting or joining. Book and pay in Grab.</p>
            <form onSubmit={event => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              if (confirm('Leave your shuttle queue and host a ride?')) {
                void act(() => send({ type: 'host', route, fare: fareFrom(data.get('fare')), name: String(data.get('name')).trim() }), 'Your ride is open.')
              }
            }}>
              <label>Your name or meetup tag<input name="name" required maxLength={40} /></label>
              <label>Total Grab fare (RM)<input name="fare" type="number" min=".01" max="10000" step=".01" required /></label>
              <button disabled={!ready || !checkInHere}>Create ride</button>
            </form>
          </section>
        </>}
      </>}
    </section>
    <nav aria-label="Student navigation">
      {(Object.keys(tabs) as Tab[]).map(id => <button key={id} className="secondary" aria-current={tab === id ? 'page' : undefined}
        onClick={() => setTab(id)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={tabs[id].icon} />
        </svg>
        {tabs[id].label}
      </button>)}
    </nav>
  </>
}

function QueueStatus({ route, db, user, checkedIn }: Session & { route: RouteId; checkedIn: boolean }) {
  const [entries, setEntries] = useState<Row<CheckIn>[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!db || !user) return
    return watchQueue(db, route, setEntries, () => { setEntries(undefined); setError(unavailable) })
  }, [route, db, user])
  const index = entries?.findIndex(entry => entry.id === user?.uid) ?? -1
  return <>
    <p>{error || (entries ? `${entries.length} students checked in at ${routes[route].origin}.` : 'Live queue count is unavailable.')}</p>
    {checkedIn && index >= 0 && <p>Your position among checked-in students is {index + 1}.</p>}
  </>
}

function RideFare({ fare, count }: { fare: number; count: number }) {
  return <p>{count} of 4 people · {money(fare)} total · about {money(fare / count)} each</p>
}

function RideList({ route, db, user, canJoin, join }: Session & { route: RouteId; canJoin: boolean; join: (id: string, name: string) => void }) {
  const [rides, setRides] = useState<Row<RideListing>[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!db || !user) return
    return watchRides(db, route, setRides, () => { setRides(undefined); setError(unavailable) })
  }, [route, db, user])
  const submit = (event: FormEvent<HTMLFormElement>, id: string) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name')).trim()
    if (name) join(id, name)
  }
  return <>
    {!rides?.length && <p>{error || (rides ? 'No Grab shares are open on this route.' : 'Live Grab listings are unavailable.')}</p>}
    {rides?.map(ride => <section key={ride.id} className="card">
      <h2>Grab share to {routes[ride.route].destination}</h2>
      <RideFare fare={ride.fare} count={ride.count} />
      {ride.count >= 4 ? <p>This ride is full.</p> : <form onSubmit={event => submit(event, ride.id)}>
        <p>After you join, your share is about {money(ride.fare / (ride.count + 1))}.</p>
        <label>Your name or meetup tag<input name="name" required maxLength={40} /></label>
        <button disabled={!canJoin}>Join ride</button>
      </form>}
    </section>)}
  </>
}
