import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { User } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { useEmulators } from './firebase'
import { compareJourney, type PublicRoom, type QueueEntry } from './journey'
import { watchQueue, watchRides } from './live'
import { watchNotices, watchSettings } from './notices'
import { formatTime, formatWeekday, routeLabel, serviceDate, timeOn, timetableSource, type RouteId } from './schedule'
import { journeyAdvice, travelAIConfigured } from './travel-ai'
import type { JourneyAdvice, TransportNotice, TravelSettings } from './travel-contract'

type Comparison = ReturnType<typeof compareJourney>
type Snapshot = { route: RouteId; uid: string; queue?: QueueEntry[]; rooms?: PublicRoom[];
  notices?: TransportNotice[]; settings?: TravelSettings; error?: string }
const money = (sen: number) => `RM ${(sen / 100).toFixed(2)}`
const minutesUntil = (time: number, now: number) => `${Math.max(0, Math.ceil((time - now) / 60_000))} minutes`

export function useTravelSnapshot(db: Firestore | undefined, user: User | undefined, route: RouteId, now: number, inRide: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  useEffect(() => {
    if (!db || !user) { setSnapshot(undefined); return }
    const uid = user.uid
    let current = true
    setSnapshot({ route, uid })
    function update(patch: Partial<Snapshot>) {
      if (current) setSnapshot(value => ({ ...value, route, uid, ...patch }))
    }
    const stops = [
      watchNotices(db, useEmulators, notices => update({ notices }), () => update({ notices: undefined })),
      watchSettings(db, route, settings => update({ settings, error: undefined }), error => update({ settings: undefined, error: error.message })),
      watchQueue(db, route, entries => update({ queue: entries.map(entry => ({ id: entry.id, joinedAt: entry.joinedAt?.toMillis() ?? NaN,
        order: entry.joinedAt ? [entry.joinedAt.seconds, entry.joinedAt.nanoseconds] : undefined })) }), () => update({ queue: undefined })),
      watchRides(db, rooms => update({ rooms }), () => update({ rooms: undefined })),
    ]
    return () => { current = false; stops.forEach(stop => stop()) }
  }, [db, user, route])
  const value = snapshot?.route === route && snapshot.uid === user?.uid ? snapshot : undefined
  return { comparison: compareJourney({ route, uid: user?.uid ?? '', now, inRide, demo: useEmulators,
    notices: value?.notices, queue: value?.queue, rooms: value?.rooms, settings: value?.settings }), settingsError: value?.error }
}

export function TravelAnnouncements({ comparison, now }: { comparison: Comparison; now: number }) {
  const visible = comparison.schedule.visible
  if (!visible.length) return null
  return <section className="card transport-announcements" aria-labelledby="transport-announcements-heading">
    <h2 id="transport-announcements-heading">Transport updates</h2>
    {visible.map((notice, index) => {
      const change = notice.changes.find(item => item.route === comparison.route)!
      const firstAffected = change.start ?? [...change.departures].sort()[0]
      const upcoming = notice.serviceDate > serviceDate(now) || notice.serviceDate === serviceDate(now)
        && !!firstAffected && now < timeOn(notice.serviceDate, firstAffected)
      return <article key={`${notice.id}@${notice.version}`} className="announcement-item">
        <small>{notice.demo ? 'DEMO · ' : ''}{upcoming ? 'Upcoming' : 'Active'} · {notice.serviceDate}</small>
        <h3>{notice.title}</h3><p>{notice.summary}</p>
        <p><strong>{routeLabel(comparison.route)}</strong>{notice.changes.length === 2 ? ' · Notice applies to both directions' : ''}</p>
        {change.start && change.end && <p>Affects services from {change.start} to {change.end}, Malaysia time.</p>}
        {change.departures.length > 0 && <p>Affected scheduled departures: {change.departures.join(', ')}.</p>}
        {change.type === 'delay' && change.delayMinutes === null && change.revisedTime === null && <p>Delay reported; duration unconfirmed.</p>}
        <details open={index === 0 && comparison.schedule.conflict ? true : undefined}><summary>View details</summary>
          {notice.reason && <p>Reason: {notice.reason}</p>}
          {change.pickup && <p>Pickup: {change.pickup}. Follow the confirmed instructions; app check-in coordinates have not changed.</p>}
          {change.capacity !== null && <p>Confirmed available seats: {change.capacity}.</p>}
          {notice.sourceExcerpt && <blockquote>{notice.sourceExcerpt}</blockquote>}
          <p>{notice.sourceLabel} · updated {serviceDate(notice.updatedAt)} at {formatTime(notice.updatedAt)} · version {notice.version}</p>
          {notice.sourceUrl && <a href={notice.sourceUrl} target="_blank" rel="noreferrer">Official source</a>}
          <p>Visible until {serviceDate(notice.expiresAt)} at {formatTime(notice.expiresAt)}.</p>
        </details>
      </article>
    })}
  </section>
}

export function NextDeparture({ comparison, now }: { comparison: Comparison; now: number }) {
  const { schedule } = comparison
  const next = schedule.next
  const continuous = schedule.continuous && !schedule.continuousSuspended
  return <section className="hero departure-card">
    <small>{continuous ? 'LRT → APU morning service' : next?.noticeIds.length ? 'Next operating departure · admin update applied' : 'Next scheduled departure'}</small>
    <h2 className={!continuous && next ? 'departure-time' : undefined}>{continuous ? 'Continuous service'
      : next ? formatTime(next.time!) : schedule.uncertain ? 'Revised time unconfirmed'
      : schedule.today.length ? 'No more confirmed departures today' : 'No scheduled service today'}</h2>
    {continuous ? <p>7:30–8:45 am · no fixed departure times{schedule.continuousUncertain ? ' · disruption reported' : ''}.</p>
      : next && <p>{next.noticeIds.length ? 'Expected' : 'Scheduled'} in {minutesUntil(next.time!, now)}.</p>}
    {next && next.original !== next.time && <p>Originally {formatTime(next.original)} → expected {formatTime(next.time!)} · admin-reported update.</p>}
    {next?.limited && <p>Limited space. Available seats are unconfirmed unless explicitly updated.</p>}
    {schedule.uncertain && <p>Some affected services have unknown or conflicting revised times. This is the next departure with a known time.</p>}
    {!next && !continuous && <p>Next weekday’s standard service · {formatWeekday(schedule.nextWeekday)} at {formatTime(schedule.nextWeekday)}. Check announcements for changes.</p>}
    {schedule.continuousSuspended && <p>Morning continuous service is suspended during the announced window.</p>}
    <p className="departure-route">{routeLabel(comparison.route)} <span>Malaysia time · estimated, not GPS tracked</span></p>
  </section>
}

function Advice({ comparison, user, enabled }: { comparison: Comparison; user?: User; enabled: boolean }) {
  const [result, setResult] = useState<{ key: string; advice?: JourneyAdvice; message?: string }>()
  const lastRequest = useRef(0)
  const cache = useRef(new Map<string, { expires: number; advice: JourneyAdvice }>())
  const key = comparison.fingerprint
  const evidenceKey = JSON.stringify(comparison.evidenceIds)
  useEffect(() => {
    if (!user || !enabled || !travelAIConfigured || useEmulators) return
    const cached = cache.current.get(key)
    if (cached && cached.expires > Date.now()) { setResult({ key, advice: cached.advice }); return }
    const controller = new AbortController()
    const wait = Math.max(1500, lastRequest.current + 30_000 - Date.now())
    const timer = setTimeout(() => {
      lastRequest.current = Date.now()
      void journeyAdvice(comparison.route, key, JSON.parse(evidenceKey), user, controller.signal).then(advice => {
        if (controller.signal.aborted) return
        if (cache.current.size >= 20) cache.current.delete(cache.current.keys().next().value!)
        cache.current.set(key, { advice, expires: Date.now() + 30_000 })
        setResult({ key, advice })
      }).catch(error => { if (!controller.signal.aborted) setResult({ key, message: error instanceof Error ? error.message : 'AI explanation unavailable.' }) })
    }, wait)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key, evidenceKey, user, enabled, comparison.route])
  if (!travelAIConfigured || useEmulators) return <p className="travel-footnote">AI explanation is not configured here. The times and comparison above are calculated from the available app data.</p>
  if (!enabled) return <p className="travel-footnote">AI explanation will update when live travel information is available.</p>
  return <div className="travel-ai-explanation" role="status">
    <h3>AI explanation</h3>
    {result?.key === key ? result.advice ? <><p>{result.advice.explanation}</p><p className="travel-footnote">Based on the current route, confirmed notices, and available choices. You decide.</p></>
      : <p>{result.message} The calculated options remain available.</p> : <p>Updating explanation… The calculated options are ready.</p>}
  </div>
}

export function TravelComparison({ comparison, now, user, inRide, aiReady, onTimetable, onRides }: {
  comparison: Comparison; now: number; user?: User; inRide: boolean; aiReady: boolean
  onTimetable: (event: MouseEvent<HTMLAnchorElement>) => void; onRides: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const { position, boarding, busNumber, cheapest } = comparison
  return <section className="card travel-comparison" aria-labelledby="travel-comparison-heading">
    <h2 id="travel-comparison-heading">Your travel options</h2>
    <div className="travel-options-grid">
    <div className="travel-option"><h3>Shuttle</h3>
      {position !== undefined && <p>{comparison.checkedIn ? 'Your check-in position' : 'If you check in now'}: <strong>{position}</strong>{!comparison.checkedIn ? ' · preview, not a reserved place' : ''}.</p>}
      {comparison.joinedAt !== undefined && <p>Checked in {serviceDate(comparison.joinedAt)} at {formatTime(comparison.joinedAt)}.</p>}
      {boarding ? <><p>Estimated boarding departure: <strong>{formatTime(boarding.time!)}</strong> · bus {busNumber} · in {minutesUntil(boarding.time!, now)}.</p>
        {boarding.time !== boarding.original && <p>Originally {formatTime(boarding.original)} · admin-reported revised time.</p>}</>
        : <p>A personal boarding time is not established by the current information.</p>}
      <p className="travel-footnote">App check-ins and configured seats are estimates of the queue. Boarding is not guaranteed.</p>
      <a className="student-link" href="?view=timetable" onClick={onTimetable}>View timetable</a>
    </div>
    <div className="travel-option"><h3>{inRide ? 'Your Grab group' : 'Lowest total-fare Grab room'}</h3>
      {inRide ? <p>You already have a group. Open it to view the current fare and members.</p> : cheapest ? <>
        <p><strong>{money(cheapest.fare)} total</strong> · {cheapest.count} of 4 people.</p>
        <p>{comparison.priceLabel}{comparison.range ? ` · ${comparison.rush ? 'rush-hour' : 'normal'} reference ${money(comparison.range[0])}–${money(comparison.range[1])} total` : ''}.</p>
        <p>After you join: about {money(cheapest.fare / (cheapest.count + 1))} each.</p>
        <p>If four people join: about {money(cheapest.fare / 4)} each. The room may not fill.</p>
      </> : <p>{comparison.roomsAvailable === undefined ? 'Grab listings are unavailable; availability could not be checked.' : 'No same-route rooms currently have an available place.'}</p>}
      <a className="student-link" href={inRide ? '?view=rides' : '?view=find'} onClick={onRides}>{inRide ? 'View your ride' : cheapest ? 'View ride room' : 'View Grab shares'}</a>
      <p className="travel-footnote">Availability is checked again when joining. Book and pay in Grab.</p>
    </div>
    </div>
    {comparison.warnings.length > 0 && <ul className="travel-cautions">{comparison.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    <Advice comparison={comparison} user={user} enabled={aiReady} />
  </section>
}

export function TravelTimetable({ comparison, now }: { comparison: Comparison; now: number }) {
  const { schedule } = comparison
  return <section className="card travel-timetable">
    <h2>{formatWeekday(now)} departures</h2><p>{routeLabel(comparison.route)} · Malaysia time</p>
    <p>Standard times with confirmed temporary changes. <a href={timetableSource.url} target="_blank" rel="noreferrer">APU source · effective {timetableSource.effectiveDate}</a></p>
    {comparison.route === 'lrt' && <p className="notice">Weekdays, 7:30–8:45 am: continuous service without fixed departure times. Confirmed suspension/delay windows appear in the announcements.</p>}
    {schedule.trips.length ? <ul className="times">{schedule.trips.map(trip => <li key={trip.id} data-next={!schedule.continuous && trip.id === schedule.next?.id || undefined}>
      <div><time dateTime={new Date(trip.original).toISOString()}>{formatTime(trip.original)}</time>
        {trip.time !== null && trip.time !== trip.original && <strong className="revised-time"> → {formatTime(trip.time)}</strong>}
        {serviceDate(trip.original) !== serviceDate(now) && <small className="trip-detail">Original service date: {serviceDate(trip.original)}</small>}
        {trip.limited && <small className="trip-detail">Limited space</small>}
        {trip.noticeIds.length > 0 && <small className="trip-detail">Admin update applied</small>}
      </div>
      <span>{trip.cancelled ? 'Cancelled / suspended' : trip.conflict ? 'Conflicting updates' : trip.time === null ? 'Delay · time unknown'
        : trip.replacement ? 'Replacement, not an extra bus' : trip.time !== trip.original ? 'Reported revised time' : trip.time < now ? 'Scheduled earlier' : trip.id === schedule.next?.id && !schedule.continuous ? 'Next shuttle' : 'Upcoming'}</span>
    </li>)}</ul> : <p>No standard service today. Shuttles run Monday through Friday.</p>}
    <p className="travel-footnote">Times are estimates and subject to traffic. Passing a scheduled time does not prove a bus departed.</p>
    {!schedule.next && <p>Next weekday’s standard service: {formatWeekday(schedule.nextWeekday)} at {formatTime(schedule.nextWeekday)}.</p>}
  </section>
}
