import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { useEmulators } from './firebase'
import { compareJourney, type QueueEntry } from './journey'
import { watchQueue } from './live'
import { watchNotices } from './notices'
import { formatTime, formatWeekday, routeLabel, serviceDate, timeOn, type RouteId } from './schedule'
import type { TransportNotice } from './travel-contract'

type Comparison = ReturnType<typeof compareJourney>
type Snapshot = { route: RouteId; uid: string; queue?: QueueEntry[]; notices?: TransportNotice[] }
const minutesUntil = (time: number, now: number) => `${Math.max(0, Math.ceil((time - now) / 60_000))} minutes`

export function useTravelSnapshot(db: Firestore | undefined, user: User | undefined, route: RouteId, now: number) {
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
      watchQueue(db, route, entries => update({ queue: entries.map(entry => ({ id: entry.id, joinedAt: entry.joinedAt?.toMillis() ?? NaN,
        order: entry.joinedAt ? [entry.joinedAt.seconds, entry.joinedAt.nanoseconds] : undefined })) }), () => update({ queue: undefined })),
    ]
    return () => { current = false; stops.forEach(stop => stop()) }
  }, [db, user, route])
  const value = snapshot?.route === route && snapshot.uid === user?.uid ? snapshot : undefined
  return compareJourney({ route, uid: user?.uid ?? '', now, demo: useEmulators,
    notices: value?.notices, queue: value?.queue })
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

export function TravelTimetable({ comparison, now }: { comparison: Comparison; now: number }) {
  const { schedule } = comparison
  return <section className="card travel-timetable">
    <h2>{formatWeekday(now)} departures</h2><p>{routeLabel(comparison.route)} · Malaysia time</p>
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
