import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import type { User } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { pickups } from './config'
import { useEmulators } from './firebase'
import { updateActivity, watchActivity, watchRide, watchRideMembership, watchRides, type Activity, type Ride, type RideListing, type RideMembership, type Row } from './live'
import { confirmPickup } from './pickup'
import { routeIds, routes, type RouteId } from './schedule'
import { NextDeparture, TravelAnnouncements, TravelTimetable, useTravelSnapshot } from './travel-student'

const tabs = {
  home: { label: 'Home', icon: 'M3 10 12 3l9 7v11h-6v-7H9v7H3z' },
  timetable: { label: 'Timetable', icon: 'M4 5h16v16H4z M4 10h16 M8 2v6 M16 2v6' },
  rides: { label: 'Share a Grab', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 21v-2a4 4 0 0 0-2-3.5 M16 3.2a4 4 0 0 1 0 7.6' },
}
type Tab = keyof typeof tabs
type StudentView = Tab | 'find'
type Command = Parameters<typeof updateActivity>[2]
type Session = { db?: Firestore; user?: User }
const money = (sen: number) => `RM ${(sen / 100).toFixed(2)}`
const unavailable = 'Live data is unavailable. Check your connection and reload.'

function studentView(): StudentView {
  const view = new URLSearchParams(location.search).get('view')
  return view === 'timetable' || view === 'rides' || view === 'find' ? view : 'home'
}

function viewUrl(view: StudentView) {
  const url = new URL(location.href)
  if (view === 'home') url.searchParams.delete('view')
  else url.searchParams.set('view', view)
  return `${url.pathname}${url.search}`
}

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

function FindRideLink({ onClick }: { onClick: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  return <a href={viewUrl('find')} className="find-ride-button student-link" onClick={onClick}>
    <RouteIcon path="m5 11 1.5-4h11l1.5 4M5 17v2m14-2v2M7.5 14h1m7 0h1M5 11h14a1 1 0 0 1 1 1v5H4v-5a1 1 0 0 1 1-1Z" />
    Find a ride
  </a>
}

function RideField({ label, fare, defaultValue }: { label: string; fare?: boolean; defaultValue?: string }) {
  const id = useId()
  const [error, setError] = useState('')
  const validate = (input: HTMLInputElement) => setError(input.validity.patternMismatch
    ? 'Enter your name or a meetup tag.' : input.validationMessage)

  return <div className="ride-field">
    <label>
      <input name={fare ? 'fare' : 'name'} type={fare ? 'number' : 'text'} required placeholder=" "
        defaultValue={defaultValue} min={fare ? '.01' : undefined} max={fare ? '10000' : undefined}
        step={fare ? '.01' : undefined} inputMode={fare ? 'decimal' : undefined}
        maxLength={fare ? undefined : 40} pattern={fare ? undefined : '.*\\S.*'}
        aria-invalid={error ? true : undefined} aria-describedby={error ? id : undefined}
        onBlur={event => validate(event.currentTarget)} onInvalid={event => validate(event.currentTarget)}
        onChange={event => { if (error && event.currentTarget.validity.valid) setError('') }} />
      <span>{label}</span>
    </label>
    {error && <p id={id} className="field-error">{error}</p>}
  </div>
}

function fareFrom(value: FormDataEntryValue | null) {
  const fare = Math.round(Number(value) * 100)
  if (!Number.isInteger(fare) || fare < 1 || fare > 1_000_000) throw new Error('Enter a fare from RM 0.01 to RM 10,000.')
  return fare
}

export function Student({ db, user }: Session) {
  const [route, setRoute] = useState<RouteId>('apu')
  const [view, setView] = useState(studentView)
  const tab = view === 'find' ? 'rides' : view
  const heading = useRef<HTMLHeadingElement>(null)
  const focusHeading = useRef(false)
  const [now, setNow] = useState(Date.now)
  const [activity, setActivity] = useState<Activity>()
  const [activityReady, setActivityReady] = useState(false)
  const [membership, setMembership] = useState<RideMembership>()
  const [membershipReady, setMembershipReady] = useState(false)
  const [membershipError, setMembershipError] = useState('')
  const [ride, setRide] = useState<Row<Ride>>()
  const [rideWatchVersion, setRideWatchVersion] = useState(0)
  const stopWatchingRide = useRef<() => void>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string }>()
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const previousFare = useRef<{ rideId: string; fare: number }>(null)
  const shareDialog = useRef<HTMLDialogElement>(null)
  const [pendingShare, setPendingShare] = useState<(
    { action: 'Create' | 'Join'; route: RouteId } | { action: 'Cancel'; rideId: string }
  ) & {
    submit: () => Promise<unknown>
    message: string
  }>()

  useEffect(() => {
    function restoreView() {
      focusHeading.current = true
      setView(studentView())
    }
    window.addEventListener('popstate', restoreView)
    return () => window.removeEventListener('popstate', restoreView)
  }, [])

  useEffect(() => {
    if (!focusHeading.current) return
    focusHeading.current = false
    heading.current?.focus({ preventScroll: true })
  }, [view])

  function navigate(event: MouseEvent<HTMLAnchorElement>, next: StudentView) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (next === view) return
    history.pushState(null, '', viewUrl(next))
    focusHeading.current = true
    setView(next)
    window.scrollTo(0, 0)
  }

  useEffect(() => {
    if (pendingShare) shareDialog.current?.showModal()
  }, [pendingShare])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(undefined), 5_000)
    return () => window.clearTimeout(timer)
  }, [toast])

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
    }, () => { setActivityReady(false); setToast({ kind: 'error', message: unavailable }) })
  }, [db, user])
  useEffect(() => {
    setMembership(undefined)
    setMembershipReady(false)
    setMembershipError('')
    if (!db || !user) return
    return watchRideMembership(db, user.uid, value => {
      setMembership(value)
      setMembershipReady(true)
      setMembershipError('')
    }, failure => {
      setMembershipReady(false)
      setMembershipError(failure.message)
      setToast({ kind: 'error', message: `Grab access unavailable: ${failure.message}` })
    })
  }, [db, user])
  const legacyRide = activity?.kind === 'ride' ? activity : undefined
  const rideId = (membership ?? legacyRide)?.rideId
  useEffect(() => {
    setRide(undefined)
    if (!db || !rideId) return
    const stop = watchRide(db, rideId, setRide, () => setToast({ kind: 'error', message: unavailable }))
    stopWatchingRide.current = stop
    return () => {
      stop()
      stopWatchingRide.current = null
    }
  }, [db, rideId, rideWatchVersion])
  const currentRide = ride?.id === rideId ? ride : undefined
  const inRide = !!rideId && (!currentRide || currentRide.status === 'open')
  const rideStatus = currentRide?.status

  useEffect(() => {
    if (!currentRide || !user || currentRide.status !== 'open') {
      previousFare.current = null
      return
    }
    const previous = previousFare.current
    const { id, fare, host, members } = currentRide
    previousFare.current = { rideId: id, fare }
    if (user.uid !== host && Object.hasOwn(members, user.uid) && previous?.rideId === id && previous.fare !== fare) {
      const share = fare / Object.keys(members).length
      setToast({ kind: 'success', message: `Fare updated to ${money(fare)} total, about ${money(share)} each.` })
    }
  }, [currentRide, user])

  useEffect(() => {
    if (rideStatus === 'departed' || rideStatus === 'cancelled') {
      setToast({
        kind: 'success',
        message: rideStatus === 'departed' ? 'Your group marked this ride as departed.' : 'The host cancelled your ride.',
      })
    }
  }, [rideId, rideStatus])

  async function act(action: () => Promise<unknown>, message = '') {
    if (running.current) return
    running.current = true
    setBusy(true)
    setToast(undefined)
    try {
      await action()
      if (message) setToast({ kind: 'success', message })
    } catch (failure) {
      setToast({ kind: 'error', message: failure instanceof Error ? failure.message : 'Please try again.' })
    } finally {
      setBusy(false)
      running.current = false
    }
  }

  const send = (command: Command) => {
    if (!db || !user) throw new Error('Firebase is unavailable.')
    return updateActivity(db, user.uid, command)
  }
  const leaveRide = () => act(async () => {
    // Leaving revokes roster access as soon as the transaction commits.
    stopWatchingRide.current?.()
    try {
      await send({ type: 'leave-ride' })
      setMembership(current => current?.rideId === rideId ? undefined : current)
      setActivity(current => current?.kind === 'ride' && current.rideId === rideId ? undefined : current)
    } catch (failure) {
      setRideWatchVersion(version => version + 1)
      throw failure
    }
  }, 'You left the ride.')
  const selected = routes[route]
  const point = pickups[route]
  const comparison = useTravelSnapshot(db, user, route, now,
    activityReady && activity?.kind === 'queue' ? activity.route : undefined)
  const ready = activityReady && !busy
  const checkInHere = activity?.kind === 'queue' && activity.route === route
  const canShare = (pickup: RouteId) => ready && membershipReady && !inRide
    && activity?.kind === 'queue' && activity.route === pickup
  const cancellingRide = pendingShare?.action === 'Cancel'
  const canConfirm = pendingShare && (cancellingRide
    ? ready && currentRide?.id === pendingShare.rideId && currentRide.status === 'open' && currentRide.host === user?.uid
    : canShare(pendingShare.route))
  const browsingRides = view === 'find' && !inRide
  const checkIn = () => act(async () => {
    if (!point) throw new Error('This pickup point is unconfirmed.')
    await confirmPickup(point)
    await send({ type: 'check-in', route })
  }, 'You’re checked in.')

  return <>
    <section className="content student" data-view={tab}>
      <header className="student-page-heading">
      <p className="student-eyebrow">{tab === 'home' ? 'Campus transit' : tab === 'timetable' ? 'Plan your trip' : 'Split the fare'}</p>
      <h1 ref={heading} tabIndex={-1}>{browsingRides ? 'Find a ride' : tab === 'home' ? 'Campus shuttle' : tabs[tab].label}</h1>
      </header>
      {!browsingRides && <RoutePicker key={tab} route={route} disabled={busy} onChange={setRoute} />}
      {(tab === 'home' || tab === 'timetable') && <TravelAnnouncements comparison={comparison} now={now} />}
      {tab === 'home' && <>
        <NextDeparture comparison={comparison} now={now} />
        <section className="card queue-card">
          <h2>{checkInHere ? 'You’re checked in' : activity?.kind === 'queue' ? 'Checked in at another stop' : 'Waiting at the stop?'}</h2>
          <p className="home-card-description">{checkInHere
            ? `You’re in the shuttle queue at ${selected.origin}.`
            : activity?.kind === 'queue'
              ? `You’re in the ${routes[activity.route].origin} queue. Leave it before checking in at ${selected.origin}.`
              : `Check in at ${selected.origin} to join the shuttle queue.`}</p>
          <div className="queue-stats" role="status" aria-atomic="true">
            <div><span>Waiting at {selected.origin}</span><strong>{comparison.queueCount ?? '—'}</strong></div>
            {checkInHere && comparison.checkedIn && <div><span>Your position</span><strong>#{comparison.position}</strong></div>}
          </div>
          {comparison.queueCount === undefined && <p>Queue unavailable.</p>}
          {!point && <p>Pickup location unavailable.</p>}
          <div className="home-card-actions">{activity?.kind === 'queue'
            ? <div className="actions">
              {checkInHere && <button disabled={!ready} onClick={() => void act(
                () => send({ type: 'board', route, eventId: activity.eventId }),
                'You’re off the queue. Have a good trip!',
              )}>I got the bus</button>}
              <button className="secondary" disabled={!ready} onClick={() => void act(() => send({ type: 'leave-queue' }), 'Queue spot released.')}>
                Leave queue
              </button>
            </div>
            : <button disabled={!ready || !point || (!!legacyRide && inRide)} onClick={() => void checkIn()}>
              Check in
            </button>}</div>
          {legacyRide && inRide && <p>Leave your Grab group to check in.</p>}
        </section>
        <section className="card grab-prompt"><h2>Share a Grab to {selected.destination}</h2>
          <p className="home-card-description">Find a group of up to 4 people and split the fare. Book and pay in Grab.</p>
          <div className="home-card-actions"><FindRideLink onClick={event => navigate(event, 'find')} /></div>
        </section>
      </>}
      {tab === 'timetable' && <TravelTimetable comparison={comparison} now={now} />}
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
              <RideField label="New total fare (RM)" fare defaultValue={(currentRide.fare / 100).toFixed(2)} />
              <button className="secondary" disabled={!ready}>Save fare</button>
            </form>
            <div className="actions">
              <button disabled={!ready} onClick={() => void act(() => send({ type: 'close', status: 'departed' }), 'Ride marked as departed.')}>We have departed</button>
              <button className="secondary" disabled={!ready} onClick={() => setPendingShare({
                action: 'Cancel',
                rideId: currentRide.id,
                submit: () => send({ type: 'close', status: 'cancelled' }),
                message: 'Ride cancelled.',
              })}>Cancel ride</button>
            </div>
          </> : <button className="secondary" disabled={!ready} onClick={() => void leaveRide()}>Leave ride</button>}
        </section> : <>
          {browsingRides ? <>
            <a className="student-link" href={viewUrl('rides')} onClick={event => navigate(event, 'rides')}>Back to Grab shares</a>
            {activityReady && activity?.kind !== 'queue' && <p>Check in at a ride’s pickup to join it.</p>}
            <RideList db={db} user={user} canJoin={canShare} join={(ride, name) => {
              setPendingShare({
                action: 'Join',
                route: ride.route,
                submit: () => send({ type: 'join', route: ride.route, rideId: ride.id, name }),
                message: 'You joined the ride.',
              })
            }} />
          </> : <>
            <FindRideLink onClick={event => navigate(event, 'find')} />
            <section className="card">
              <h2>Host a ride</h2>
              <p>Check in at this pickup before hosting. Book and pay in Grab.</p>
              {activityReady && !checkInHere && <p className="form-help">{activity?.kind === 'queue'
                ? `You are checked in at ${routes[activity.route].origin}. Select that route to host there.`
                : 'Check in on Home first to enable Create ride.'}</p>}
              {checkInHere && !membershipReady && <p className="form-help">{membershipError
                ? 'Grab access is unavailable. Your check-in is kept. Refresh to retry.'
                : 'Checking your Grab access…'}</p>}
              <form onSubmit={event => {
                event.preventDefault()
                const data = new FormData(event.currentTarget)
                setPendingShare({
                  action: 'Create',
                  route,
                  submit: async () => {
                    if (!point) throw new Error('This pickup point is unconfirmed.')
                    await confirmPickup(point)
                    await send({ type: 'host', route, fare: fareFrom(data.get('fare')), name: String(data.get('name')).trim() })
                  },
                  message: 'Your ride is open.',
                })
              }}>
                <RideField label="Your name or meetup tag" />
                <RideField label="Total Grab fare (RM)" fare />
                <button disabled={!canShare(route)}>Create ride</button>
              </form>
            </section>
          </>}
        </>}
      </>}
      <dialog ref={shareDialog} className="ride-dialog" aria-labelledby="share-ride-title"
        aria-describedby="share-ride-description" onClose={() => setPendingShare(undefined)}>
        <h2 id="share-ride-title">{pendingShare?.action} this Grab share?</h2>
        <p id="share-ride-description">
          {cancellingRide ? 'This cancels the ride for everyone. Shuttle queue spots are kept.' : 'You’ll keep your shuttle queue spot.'}
        </p>
        <div className="actions">
          <button type="button" className="secondary" autoFocus onClick={() => shareDialog.current?.close()}>Go back</button>
          <button type="button" disabled={!canConfirm} onClick={() => {
            if (!pendingShare) return
            shareDialog.current?.close()
            void act(pendingShare.submit, pendingShare.message)
          }}>{pendingShare?.action} ride</button>
        </div>
      </dialog>
    </section>
    <nav className="student-nav" aria-label="Student navigation">
      <div className="student-toasts">
        <div role="status">{toast?.kind === 'success' && <p className="student-toast">{toast.message}</p>}</div>
        <div role="alert">{toast?.kind === 'error' && <p className="student-toast error">{toast.message}</p>}</div>
      </div>
      {(Object.keys(tabs) as Tab[]).map(id => <a key={id} href={viewUrl(id)} aria-current={tab === id ? 'page' : undefined}
        onClick={event => navigate(event, id)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={tabs[id].icon} />
        </svg>
        {tabs[id].label}
      </a>)}
    </nav>
  </>
}

function RideFare({ fare, count }: { fare: number; count: number }) {
  return <div className="ride-fare">
    <p><strong>{money(fare / count)}</strong> estimated per person</p>
    <p>{count} of 4 people · {money(fare)} total</p>
  </div>
}

function RideList({ db, user, canJoin, join }: Session & {
  canJoin: (route: RouteId) => boolean
  join: (ride: Row<RideListing>, name: string) => void
}) {
  const [rides, setRides] = useState<Row<RideListing>[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!db || !user) return
    return watchRides(db, listings => {
      setRides(listings)
      setError('')
    }, failure => {
      setRides(undefined)
      console.warn('Grab listings failed:', failure)
      if (failure.code === 'permission-denied') {
        setError(useEmulators
          ? 'The local Firestore rules denied access to Grab shares.'
          : 'Firebase denied access to Grab shares. For local testing, start the app with npm run dev:local.')
      } else {
        setError(`Grab shares could not load (${failure.code}).`)
      }
    })
  }, [db, user])
  const submit = (event: FormEvent<HTMLFormElement>, ride: Row<RideListing>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name')).trim()
    if (name) join(ride, name)
  }
  return <>
    {!rides?.length && <div className="card" role="status"><p>{error || (rides ? 'No Grab shares are open right now.'
      : db && user ? 'Loading Grab shares…' : 'Live Grab listings are unavailable.')}</p></div>}
    {rides?.map(ride => <section key={ride.id} className="card">
      <h2>{routes[ride.route].origin} → {routes[ride.route].destination}</h2>
      {ride.id.startsWith('sample-savanna-20261112-') && <p>Sample ride · for testing</p>}
      <RideFare fare={ride.fare} count={ride.count} />
      {ride.count >= 4 ? <p>This ride is full.</p> : <form onSubmit={event => submit(event, ride)}>
        <p>After you join, your share is about {money(ride.fare / (ride.count + 1))}.</p>
        <RideField label="Your name or meetup tag" />
        <button disabled={!canJoin(ride.route)}>Join ride</button>
      </form>}
    </section>)}
  </>
}
