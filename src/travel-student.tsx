import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { useEmulators } from './firebase'
import { compareJourney, compareStudentJourney, type QueueEntry } from './journey'
import { watchQueue } from './live'
import { watchNotices } from './notices'
import { formatTime, formatWeekday, routeLabel, serviceDate, timeOn, type RouteId } from './schedule'
import { noticeExpiresAt, type TransportNotice } from './travel-contract'

type Comparison = ReturnType<typeof compareJourney>
type Snapshot = { route: RouteId; uid: string; checkedInRoute?: RouteId; queue?: QueueEntry[]; notices?: TransportNotice[] }
const minutesUntil = (time: number, now: number) => {
  const minutes = Math.max(0, Math.ceil((time - now) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const remaining = minutes % 60
  return `${Math.floor(minutes / 60)} hr${remaining ? ` ${remaining} min` : ''}`
}

export function useTravelSnapshot(db: Firestore | undefined, user: User | undefined, route: RouteId, now: number, checkedInRoute?: RouteId) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  useEffect(() => {
    if (!db || !user) { setSnapshot(undefined); return }
    const uid = user.uid
    let current = true
    setSnapshot({ route, uid, checkedInRoute })
    function update(patch: Partial<Snapshot>) {
      if (current) setSnapshot(value => ({ ...value, route, uid, checkedInRoute, ...patch }))
    }
    const stops = [
      watchQueue(db, route, entries => update({ queue: entries.map(entry => ({ id: entry.id, joinedAt: entry.joinedAt?.toMillis() ?? NaN,
        order: entry.joinedAt ? [entry.joinedAt.seconds, entry.joinedAt.nanoseconds] : undefined })) }), () => update({ queue: undefined })),
    ]
    if (checkedInRoute === route) stops.push(
      watchNotices(db, useEmulators, notices => update({ notices }), () => update({ notices: undefined })),
    )
    return () => { current = false; stops.forEach(stop => stop()) }
  }, [db, user, route, checkedInRoute])
  const value = snapshot?.route === route && snapshot.uid === user?.uid && snapshot.checkedInRoute === checkedInRoute ? snapshot : undefined
  return compareStudentJourney({ route, uid: user?.uid ?? '', now, demo: useEmulators,
    notices: value?.notices, queue: value?.queue }, checkedInRoute)
}

export function TravelAnnouncements({ comparison, now }: { comparison: Comparison; now: number }) {
  const visible = comparison.schedule.visible
  if (comparison.warnings.some(warning => warning.startsWith('Announcements are unavailable.'))) {
    return <p className="notice" role="status">Updates unavailable. Showing the standard timetable.</p>
  }
  if (!visible.length) return null
  return <section className="card transport-announcements" aria-labelledby="transport-announcements-heading">
    <h2 id="transport-announcements-heading">Transport updates</h2>
    {visible.map((notice, index) => {
      const change = notice.changes.find(item => item.route === comparison.route)!
      const firstAffected = change.start ?? [...change.departures].sort()[0]
      const upcoming = notice.serviceDate > serviceDate(now) || notice.serviceDate === serviceDate(now)
        && !!firstAffected && now < timeOn(notice.serviceDate, firstAffected)
      const label = change.type === 'delay' ? change.delayMinutes !== null ? `${minutesUntil(change.delayMinutes * 60_000, 0)} delay` : 'Shuttle delayed'
        : ({ cancel: 'Departure cancelled', suspend: 'Service suspended', replacement: 'Replacement departure',
          pickup: 'Pickup changed', capacity: 'Seat availability changed', info: notice.title })[change.type]
      const dateLabel = new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short' })
        .format(timeOn(notice.serviceDate, '00:00'))
      return <article key={`${notice.id}@${notice.version}`} className="announcement-item">
        <div className="announcement-meta">
          <span className="announcement-status">{notice.demo ? 'Demo · ' : ''}{upcoming ? 'Upcoming' : 'Active'}</span>
          <time dateTime={notice.serviceDate}>{dateLabel} · Malaysia time</time>
        </div>
        <h3 className="announcement-title">{label}</h3>
        <p className="announcement-route">{routeLabel(comparison.route)}</p>
        {change.start && change.end && <p className="announcement-window">Affected period: {formatTime(timeOn(notice.serviceDate, change.start))}–{formatTime(timeOn(notice.serviceDate, change.end))}</p>}
        {change.departures.map(departure => {
          const original = timeOn(notice.serviceDate, departure)
          const trip = comparison.schedule.trips.find(item => item.original === original)
          const expected = trip?.conflict ? null : change.revisedTime ? timeOn(notice.serviceDate, change.revisedTime)
            : change.delayMinutes !== null ? original + change.delayMinutes * 60_000 : null
          const revised = change.type === 'delay' || change.type === 'replacement'
          return <dl className="announcement-times" key={departure}>
            <div><dt>{revised ? 'Originally' : 'Scheduled departure'}</dt><dd>{formatTime(original)}</dd></div>
            {revised && <>
              <span className="announcement-arrow" aria-hidden="true">→</span>
              <div><dt>Expected departure</dt><dd>{expected === null ? 'Time unconfirmed' : formatTime(expected)}</dd>
                {expected !== null && serviceDate(expected) !== notice.serviceDate && <small>{serviceDate(expected)}</small>}</div>
            </>}
          </dl>
        })}
        {change.type === 'delay' && !change.departures.length && <p>{change.delayMinutes !== null ? 'Affected services are running late.' : 'Delay duration is not confirmed yet.'}</p>}
        {!change.departures.length && change.revisedTime && <p>Expected departure: {formatTime(timeOn(notice.serviceDate, change.revisedTime))}</p>}
        {notice.reason && <p className="announcement-reason">Reason: {notice.reason}</p>}
        {change.pickup && <p>Pickup: {change.pickup}. Follow the admin’s pickup instructions.</p>}
        {change.capacity !== null && <p>Available seats: {change.capacity}.</p>}
        {change.type === 'info' && <p>{notice.summary}</p>}
        <details open={index === 0 && comparison.schedule.conflict ? true : undefined}>
          <summary>More details <span aria-hidden="true">⌄</span></summary>
          <div className="announcement-details">
            {change.type !== 'info' && <p>{notice.summary}</p>}
            {notice.changes.length === 2 && <p>This notice covers both directions. Times above are for your selected route.</p>}
            {change.pickup && <p>App check-in locations stay the same.</p>}
            {notice.sourceExcerpt && <blockquote>{notice.sourceExcerpt}</blockquote>}
            <p>{notice.sourceLabel} · Updated {formatTime(notice.updatedAt)} on {serviceDate(notice.updatedAt)}</p>
            {notice.sourceUrl && <a href={notice.sourceUrl} target="_blank" rel="noreferrer">Official source</a>}
            <p>Update ends {serviceDate(noticeExpiresAt(notice, comparison.route))} at {formatTime(noticeExpiresAt(notice, comparison.route))}.</p>
          </div>
        </details>
      </article>
    })}
  </section>
}

export function NextDeparture({ comparison, now }: { comparison: Comparison; now: number }) {
  const { schedule } = comparison
  const next = schedule.next
  const continuous = schedule.continuous && !schedule.continuousSuspended
  if (schedule.continuousStartsAt !== undefined) return <section className="hero departure-card">
    <small>Morning shuttle</small>
    <h2>{schedule.continuousSuspended ? 'Morning service suspended' : schedule.continuousUncertain ? 'Morning service disrupted' : 'Continuous service'}</h2>
    {!schedule.continuousSuspended && !schedule.continuousUncertain && <p>Service starts at {formatTime(schedule.continuousStartsAt)} · in {minutesUntil(schedule.continuousStartsAt, now)}.</p>}
    <p>7:30–8:45 am · no fixed departure times.</p>
    <p className="departure-route"><span>Malaysia time · timetable estimate</span></p>
  </section>
  return <section className="hero departure-card">
    <small>{continuous ? 'Morning shuttle' : !next ? 'Shuttle service' : next.noticeIds.length ? 'Next shuttle · updated' : 'Next scheduled shuttle'}</small>
    <h2 className={!continuous && next ? 'departure-time' : undefined}>{continuous ? 'Continuous service'
      : next ? formatTime(next.time!) : schedule.uncertain ? 'Time unconfirmed'
      : schedule.today.length ? 'Service ended' : 'No service today'}</h2>
    {continuous ? <p>7:30–8:45 am · no fixed times{schedule.continuousUncertain ? ' · disruption reported' : ''}.</p>
      : next && <p>{next.noticeIds.length ? 'Expected' : 'Scheduled'} in {minutesUntil(next.time!, now)}.</p>}
    {next && next.original !== next.time && <p>Originally {formatTime(next.original)} → expected {formatTime(next.time!)} · admin update.</p>}
    {next?.limited && <p>Limited space.</p>}
    {schedule.uncertain && <p>Some revised times are unconfirmed. Check updates.</p>}
    {!next && !continuous && <p>Next service: {formatWeekday(schedule.nextWeekday)}, {formatTime(schedule.nextWeekday)}.</p>}
    {schedule.continuousSuspended && <p>Morning service temporarily suspended.</p>}
    <p className="departure-route"><span>Malaysia time · timetable estimate</span></p>
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
    {!schedule.next && schedule.continuousStartsAt === undefined && <p>Next weekday’s standard service: {formatWeekday(schedule.nextWeekday)} at {formatTime(schedule.nextWeekday)}.</p>}
  </section>
}
