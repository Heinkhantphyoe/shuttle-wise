import { continuousService, departuresOn, routeLabel, scheduleFor, serviceDate, serviceDay, timeOn, timetableSource, type RouteId } from './schedule.ts'
import { validSettings, type NoticeChange, type TransportNotice, type TravelSettings } from './travel-contract.ts'

export type Trip = {
  id: string
  original: number
  time: number | null
  cancelled: boolean
  replacement: boolean
  limited: boolean
  capacity: number | null
  noticeIds: string[]
  conflict: boolean
}
export type QueueEntry = { id: string; joinedAt: number; order?: [number, number] }
export type PublicRoom = { id: string; route: RouteId; status: string; fare: number; count: number }
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export function relevantNotices(notices: TransportNotice[], route: RouteId, now: number, demo = false) {
  return notices.filter(notice => notice.status === 'published' && notice.demo === demo
    && notice.visibleFrom <= now && now < notice.expiresAt && notice.changes.some(change => change.route === route))
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

export function affects(change: NoticeChange, original: number, date: string) {
  const time = new Date(original + 8 * 3_600_000).toISOString().slice(11, 16)
  return change.departures.includes(time) || !!(change.start && change.end
    && original >= timeOn(date, change.start) && original < timeOn(date, change.end))
}

// All temporary changes are derived here. Neither notices nor calculations mutate routes.
export function effectiveSchedule(route: RouteId, now: number, notices: TransportNotice[], settings?: TravelSettings, demo = false) {
  const base = scheduleFor(route, now)
  const visible = relevantNotices(notices, route, now, demo)
  const today = serviceDate(now)
  // Include yesterday only for explicitly delayed services that may cross midnight.
  const previousDate = serviceDate(now - 86_400_000)
  const dates = [previousDate, today]
  const trips: Trip[] = []
  for (const date of dates) {
    const day = serviceDay(timeOn(date, '00:00'))
    const applicable = visible.filter(notice => notice.serviceDate === date)
    for (const original of departuresOn(route, day)) {
      const operations = applicable.flatMap(notice => notice.changes.filter(change => change.route === route
        && affects(change, original, date) && !['info', 'pickup'].includes(change.type)).map(change => ({ notice, change })))
      if (date === previousDate && !operations.some(({ change }) => change.type === 'delay' || change.type === 'replacement')) continue
      const timing = operations.filter(({ change }) => change.type !== 'capacity')
      const capacities = operations.filter(({ change }) => change.type === 'capacity')
      const conflict = timing.length > 1 || capacities.length > 1
      const operation = timing[0]?.change
      let time: number | null = original
      let cancelled = false
      if (conflict) time = null
      else if (operation?.type === 'cancel' || operation?.type === 'suspend') cancelled = true
      else if (operation?.type === 'replacement' || operation?.type === 'delay') {
        time = operation.revisedTime ? timeOn(date, operation.revisedTime)
          : operation.delayMinutes !== null ? original + operation.delayMinutes * 60_000 : null
      }
      const limited = route === 'apu' && ['20:45', '21:45'].some(value => original === timeOn(date, value))
      trips.push({
        id: `${route}:${date}:${original}`, original, time, cancelled, limited, conflict, replacement: operation?.type === 'replacement',
        capacity: capacities[0]?.change.capacity ?? (limited ? null : settings?.capacity ?? null),
        noticeIds: [...new Set(operations.map(({ notice }) => `${notice.id}@${notice.version}`))],
      })
    }
  }
  // Different scheduled buses can share a revised time. Only explicit replacements are deduplicated.
  const ordered = trips.filter(trip => !trip.cancelled && trip.time !== null && trip.time >= now)
    .sort((a, b) => a.time! - b.time! || a.original - b.original)
  const future = ordered.filter(trip => !trip.replacement).map(trip => ({ ...trip }))
  for (const trip of ordered.filter(trip => trip.replacement)) {
    const existing = future.find(item => item.time === trip.time)
    if (existing) existing.noticeIds = [...new Set([...existing.noticeIds, ...trip.noticeIds])]
    else future.push({ ...trip })
  }
  future.sort((a, b) => a.time! - b.time! || a.original - b.original)
  const continuousNotices = visible.filter(notice => notice.serviceDate === today).flatMap(notice => notice.changes)
    .filter(change => change.route === route && change.start && change.end
      && now >= timeOn(today, change.start) && now < timeOn(today, change.end))
  const continuous = continuousService(route, now)
  const continuousSuspended = continuous && continuousNotices.some(change => change.type === 'suspend')
  const continuousUncertain = continuous && continuousNotices.some(change => ['delay', 'cancel', 'replacement'].includes(change.type))
  const unknown = trips.filter(trip => trip.time === null)
  return { ...base, trips, future, next: future[0], visible, continuous, continuousSuspended, continuousUncertain,
    uncertain: unknown.length > 0 || continuousUncertain, conflict: trips.some(trip => trip.conflict) }
}

export function conflictingNoticeIds(draft: TransportNotice, existing: TransportNotice[]) {
  const conflicts = new Set<string>()
  for (const other of existing) {
    if (other.id === draft.id || other.status !== 'published' || other.demo !== draft.demo || other.serviceDate !== draft.serviceDate
      || other.expiresAt <= draft.visibleFrom || draft.expiresAt <= other.visibleFrom) continue
    for (const change of draft.changes) {
      if (['info', 'pickup'].includes(change.type)) continue
      for (const before of other.changes.filter(item => item.route === change.route && !['info', 'pickup'].includes(item.type))) {
        // Capacity and timing may coexist; two updates to the same property need explicit resolution.
        if ((before.type === 'capacity') !== (change.type === 'capacity')) continue
        const times = departuresOn(change.route, serviceDay(timeOn(draft.serviceDate, '00:00')))
        const windowsOverlap = change.start && change.end && before.start && before.end
          && change.start < before.end && before.start < change.end
        if (windowsOverlap || times.some(time => affects(change, time, draft.serviceDate) && affects(before, time, draft.serviceDate))) conflicts.add(other.id)
      }
    }
  }
  return [...conflicts]
}

export function fareRange(settings: TravelSettings | undefined, now: number) {
  if (!settings) return { range: null, rush: false }
  const local = new Date(now + 8 * 3_600_000)
  const time = local.toISOString().slice(11, 16)
  const rush = settings.rushWindows.some(window => window.days.includes(local.getUTCDay()) && window.start <= time && time < window.end)
  return { range: rush ? settings.rushFare : settings.normalFare, rush }
}

export function compareJourney(input: {
  route: RouteId; now: number; uid: string; queue?: QueueEntry[]; rooms?: PublicRoom[]
  notices?: TransportNotice[]; settings?: TravelSettings; inRide?: boolean; demo?: boolean
}) {
  const { route, now, uid } = input
  let settings = input.settings && validSettings(input.settings) ? input.settings : undefined
  if (settings && settings.demo !== !!input.demo) settings = undefined
  const schedule = effectiveSchedule(route, now, input.notices ?? [], settings, input.demo)
  const validQueue = input.queue?.every(entry => entry.id && Number.isFinite(entry.joinedAt) && entry.joinedAt <= now)
    && new Set(input.queue.map(entry => entry.id)).size === input.queue.length
  const queue = validQueue ? [...input.queue!].sort((a, b) => (a.order && b.order
    ? a.order[0] - b.order[0] || a.order[1] - b.order[1] : a.joinedAt - b.joinedAt) || compareIds(a.id, b.id)) : undefined
  const index = queue?.findIndex(entry => entry.id === uid) ?? -1
  const position = queue ? index >= 0 ? index + 1 : queue.length + 1 : undefined
  const checkedIn = index >= 0
  let seats = 0
  let boarding: Trip | undefined
  let busNumber: number | undefined
  if (position !== undefined && input.notices !== undefined && !schedule.uncertain && !schedule.continuous) {
    for (const [index, trip] of schedule.future.entries()) {
      if (trip.capacity === null || trip.capacity <= 0) break
      seats += trip.capacity
      if (seats >= position) { boarding = trip; busNumber = index + 1; break }
    }
  }
  const rooms = input.rooms?.filter(room => room.route === route && room.status === 'open'
    && Number.isSafeInteger(room.fare) && room.fare >= 1 && room.fare <= 1_000_000
    && Number.isSafeInteger(room.count) && room.count >= 1 && room.count < 4)
    .sort((a, b) => a.fare - b.fare || compareIds(a.id, b.id))
  const cheapest = input.inRide ? undefined : rooms?.[0]
  const { range, rush } = fareRange(settings, now)
  const priceLabel = !range || !cheapest ? 'Reference range unavailable'
    : cheapest.fare < range[0] ? 'Below reference range' : cheapest.fare > range[1] ? 'Above reference range' : 'Within reference range'
  const joinedAt = checkedIn ? queue![index].joinedAt : undefined
  const stale = !!queue?.some(entry => schedule.trips.some(trip => !trip.cancelled && trip.time !== null
    && trip.time < now && trip.time >= entry.joinedAt))
  const warnings: string[] = []
  if (input.notices === undefined) warnings.push('Announcements are unavailable. These are standard timetable times; temporary changes could not be checked.')
  if (!queue) warnings.push('Queue position is unavailable.')
  if (stale) warnings.push('Some check-ins remain after earlier departures. Boarding estimates may be less reliable; nobody is removed automatically.')
  if (!settings?.capacity) warnings.push('Bus capacity is unconfirmed. A boarding estimate is unavailable.')
  if (settings?.demo) warnings.push('Capacity and fare references are demo assumptions.')
  if (schedule.uncertain) warnings.push(schedule.conflict ? 'Conflicting updates need admin review. An exact boarding estimate is unavailable.' : 'A delay has no confirmed revised time. An exact boarding estimate is unavailable.')
  if (schedule.continuous) warnings.push(schedule.continuousSuspended ? 'Continuous service is temporarily suspended during the confirmed window.'
    : 'LRT → APU runs continuously from 7:30 to 8:45 am. An exact next departure and boarding time are unavailable.')
  if (position && !boarding && !schedule.continuous && !schedule.uncertain && settings?.capacity && input.notices) warnings.push('Confirmed remaining capacity does not establish a boarding time for this position.')
  const evidenceIds = [`schedule:${timetableSource.version}`, ...schedule.visible.map(notice => `${notice.id}@${notice.version}`)]
  if (settings) evidenceIds.push(`settings:${route}@${settings.version}`)
  if (boarding) evidenceIds.push(boarding.id)
  if (cheapest) evidenceIds.push(`room:${cheapest.id}`)
  // No ticking countdown in this fingerprint: only meaningful fact changes request new AI text.
  const fingerprint = JSON.stringify({ route, date: serviceDate(now), noticesReady: input.notices !== undefined,
    notices: schedule.visible.map(notice => [notice.id, notice.version]), settings: settings?.version,
    next: schedule.next?.id, nextTime: schedule.next?.time, continuous: schedule.continuous,
    continuousSuspended: schedule.continuousSuspended, uncertain: schedule.uncertain,
    position, checkedIn, stale, boarding: boarding?.id, boardingTime: boarding?.time,
    roomsReady: input.rooms !== undefined, room: cheapest && [cheapest.id, cheapest.fare, cheapest.count], inRide: !!input.inRide, rush })
  return { route, schedule, queueCount: queue?.length, position, checkedIn, joinedAt, boarding, busNumber,
    cheapest, roomsAvailable: rooms?.length, priceLabel, range, rush, stale, warnings, evidenceIds, fingerprint }
}

export function adviceFacts(comparison: ReturnType<typeof compareJourney>) {
  const cautionCodes = ['estimate_only',
    ...(comparison.stale ? ['queue_may_be_stale'] : []),
    ...(comparison.schedule.uncertain && !comparison.schedule.conflict ? ['unknown_delay'] : []),
    ...(comparison.schedule.next?.limited || comparison.boarding?.limited ? ['limited_space'] : []),
    ...(comparison.position === undefined || comparison.roomsAvailable === undefined || !comparison.boarding ? ['data_unavailable'] : []),
  ]
  return { route: routeLabel(comparison.route), queueCount: comparison.queueCount, position: comparison.position,
    checkedIn: comparison.checkedIn, next: comparison.schedule.next, boarding: comparison.boarding,
    nextDepartureAffected: !!comparison.schedule.next?.noticeIds.length, cautionCodes,
    continuous: comparison.schedule.continuous, continuousSuspended: comparison.schedule.continuousSuspended,
    cheapest: comparison.cheapest, priceLabel: comparison.priceLabel, warnings: comparison.warnings,
    notices: comparison.schedule.visible.map(notice => ({ id: `${notice.id}@${notice.version}`, title: notice.title, summary: notice.summary })),
    evidenceIds: comparison.evidenceIds }
}

