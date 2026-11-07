import { routes, serviceDay, timeOn, weekday, type RouteId } from './schedule.ts'

export const changeTypes = ['delay', 'cancel', 'suspend', 'replacement', 'pickup', 'capacity', 'info'] as const
export type ChangeType = typeof changeTypes[number]
export type NoticeChange = {
  route: RouteId
  type: ChangeType
  departures: string[]
  start: string | null
  end: string | null
  delayMinutes: number | null
  revisedTime: string | null
  capacity: number | null
  pickup: string
}
export type NoticeDraft = {
  title: string
  summary: string
  reason: string
  sourceLabel: string
  sourceExcerpt: string
  sourceUrl: string
  serviceDate: string
  visibleFrom: number
  expiresAt: number
  demo: boolean
  changes: NoticeChange[]
}
export type TransportNotice = NoticeDraft & {
  id: string
  status: 'published' | 'withdrawn' | 'superseded'
  version: number
  updatedAt: number
}
export type RushWindow = { days: number[]; start: string; end: string }
export type TravelSettings = {
  capacity: number | null
  normalFare: [number, number] | null
  rushFare: [number, number] | null
  rushWindows: RushWindow[]
  sourceLabel: string
  demo: boolean
  version: number
  updatedAt: number
}

export const isRoute = (value: unknown): value is RouteId => value === 'apu' || value === 'lrt'
export const isTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
export const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
export const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown, max: number, required = false) {
  return typeof value === 'string' && value.length <= max && (!required || !!value.trim())
}
function keys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key))
}

export function validChange(value: unknown): value is NoticeChange {
  if (!object(value) || !keys(value, ['route', 'type', 'departures', 'start', 'end', 'delayMinutes', 'revisedTime', 'capacity', 'pickup'])) return false
  return isRoute(value.route) && changeTypes.includes(value.type as ChangeType)
    && Array.isArray(value.departures) && value.departures.length <= 60 && value.departures.every(isTime)
    && new Set(value.departures).size === value.departures.length
    && (value.start === null || isTime(value.start)) && (value.end === null || isTime(value.end))
    && (value.delayMinutes === null || integer(value.delayMinutes, 1, 720))
    && (value.revisedTime === null || isTime(value.revisedTime))
    && (value.capacity === null || integer(value.capacity, 1, 200)) && text(value.pickup, 200)
}

export function validDraft(value: unknown): value is NoticeDraft {
  if (!object(value) || !keys(value, ['title', 'summary', 'reason', 'sourceLabel', 'sourceExcerpt', 'sourceUrl',
    'serviceDate', 'visibleFrom', 'expiresAt', 'demo', 'changes'])) return false
  return text(value.title, 120, true) && text(value.summary, 1000, true) && text(value.reason, 300)
    && text(value.sourceLabel, 120, true) && text(value.sourceExcerpt, 2000) && text(value.sourceUrl, 500)
    && (value.sourceUrl === '' || /^https:\/\/[^\s]+$/.test(value.sourceUrl as string))
    && isDate(value.serviceDate) && integer(value.visibleFrom, 0, 8_640_000_000_000_000)
    && integer(value.expiresAt, 0, 8_640_000_000_000_000) && value.visibleFrom < value.expiresAt
    && value.expiresAt - value.visibleFrom <= 32 * 86_400_000
    && typeof value.demo === 'boolean' && Array.isArray(value.changes) && value.changes.length >= 1
    && value.changes.length <= 2 && value.changes.every(validChange)
    && new Set(value.changes.map(change => change.route)).size === value.changes.length
}

export function noticeErrors(value: unknown): string[] {
  if (!validDraft(value)) return ['Some update details are missing or invalid. Correct the original message and read it with AI again.']
  const errors: string[] = []
  const midnight = timeOn(value.serviceDate, '00:00')
  if (value.expiresAt <= midnight || value.visibleFrom >= midnight + 2 * 86_400_000) errors.push('The display period must cover the service date.')
  for (const change of value.changes) {
    const label = `${routes[change.route].origin} → ${routes[change.route].destination}`
    const window = change.start !== null && change.end !== null && change.start < change.end
    if ((change.start !== null || change.end !== null) && !window) errors.push(`${label}: enter a complete start/end window on the same day.`)
    if (change.departures.length && window) errors.push(`${label}: choose exact departures or a time window, not both.`)
    if (change.departures.length && !weekday(serviceDay(midnight))) errors.push(`${label}: there are no standard departures on this service date.`)
    if (change.departures.some(time => !routes[change.route].departures.includes(time))) errors.push(`${label}: select departures from the standard timetable.`)
    if (['delay', 'cancel', 'capacity'].includes(change.type) && !change.departures.length && !window) errors.push(`${label}: select exact departures or an affected window.`)
    if (change.type === 'suspend' && !window) errors.push(`${label}: a suspension needs a start and end time.`)
    if (change.type === 'capacity' && change.capacity === null) errors.push(`${label}: enter the confirmed capacity.`)
    if (change.type === 'pickup' && !change.pickup.trim()) errors.push(`${label}: enter the confirmed pickup change.`)
    if (change.type === 'replacement' && (change.departures.length !== 1 || !change.revisedTime)) errors.push(`${label}: a replacement needs one original departure and one replacement time.`)
    if (change.revisedTime && (change.type !== 'replacement' && change.type !== 'delay' || change.departures.length !== 1)) errors.push(`${label}: revised time needs one delay/replacement departure.`)
    if (change.revisedTime && change.delayMinutes !== null) errors.push(`${label}: use either delay minutes or revised time.`)
    if (change.delayMinutes !== null && change.type !== 'delay') errors.push(`${label}: delay minutes apply only to delays.`)
    if (change.capacity !== null && change.type !== 'capacity') errors.push(`${label}: capacity applies only to capacity changes.`)
    if (change.type === 'delay' && change.revisedTime && change.revisedTime <= change.departures[0]) errors.push(`${label}: a delayed time must be later than the original time.`)
    const last = [...change.departures].sort().at(-1) ?? change.end
    if (last && value.expiresAt <= Math.max(timeOn(value.serviceDate, last), timeOn(value.serviceDate, change.revisedTime ?? last) + (change.delayMinutes ?? 0) * 60_000)) errors.push(`${label}: expiry must be after the original and revised service times.`)
  }
  return errors
}

export function validSettings(value: unknown): value is TravelSettings {
  if (!object(value) || !keys(value, ['capacity', 'normalFare', 'rushFare', 'rushWindows', 'sourceLabel', 'demo', 'version', 'updatedAt'])) return false
  const fare = (range: unknown) => range === null || Array.isArray(range) && range.length === 2
    && integer(range[0], 1, 1_000_000) && integer(range[1], range[0], 1_000_000)
  if (!(value.capacity === null || integer(value.capacity, 1, 200)) || !fare(value.normalFare) || !fare(value.rushFare)
    || !text(value.sourceLabel, 120, true) || typeof value.demo !== 'boolean'
    || !integer(value.version, 1, Number.MAX_SAFE_INTEGER) || !integer(value.updatedAt, 0, 8_640_000_000_000_000)
    || !Array.isArray(value.rushWindows) || value.rushWindows.length > 14) return false
  const windows = value.rushWindows
  if (!windows.every((window: unknown) => object(window) && keys(window, ['days', 'start', 'end'])
    && Array.isArray(window.days) && window.days.length > 0 && window.days.length <= 7
    && window.days.every(day => integer(day, 0, 6)) && new Set(window.days).size === window.days.length
    && isTime(window.start) && isTime(window.end) && window.start < window.end)) return false
  return !windows.some((a, index) => windows.slice(index + 1).some(b => a.days.some((day: number) => b.days.includes(day))
    && a.start < b.end && b.start < a.end))
}

export function parseNotice(value: unknown): TransportNotice {
  if (!object(value)) throw new Error('Invalid announcement record.')
  const { id, status, version, updatedAt, ...draft } = value
  if (!validDraft(draft) || noticeErrors(draft).length || !text(id, 200, true)
    || !['published', 'withdrawn', 'superseded'].includes(status as string)
    || !integer(version, 1, Number.MAX_SAFE_INTEGER) || !integer(updatedAt, 0, 8_640_000_000_000_000)) throw new Error('Invalid announcement record.')
  return value as TransportNotice
}

export type Extraction = { draft: NoticeDraft; unresolved: string[]; evidence: string[] }
export type AffectedDirection = RouteId | 'both'
export const isDirection = (value: unknown): value is AffectedDirection => isRoute(value) || value === 'both'
export const directionRoutes = (direction: AffectedDirection): RouteId[] => direction === 'both' ? ['apu', 'lrt'] : [direction]

export function scopeExtraction(result: Extraction, direction: AffectedDirection): Extraction {
  const selected = directionRoutes(direction)
  const changes = result.draft.changes.filter(change => selected.includes(change.route))
  const unresolved = [...result.unresolved]
  if (changes.length !== result.draft.changes.length) unresolved.push('The message and selected direction disagree. Correct the direction or message above.')
  if (selected.some(route => !changes.some(change => change.route === route))) unresolved.push('The message needs clear affected services for every selected direction.')
  return { ...result, draft: { ...result.draft, changes }, unresolved: [...new Set(unresolved)].slice(0, 20) }
}
export function parseExtraction(value: unknown): Extraction {
  const draft = object(value) && object(value.draft) ? value.draft : undefined
  const sample: NoticeChange = { route: 'apu', type: 'info', departures: [], start: null, end: null, delayMinutes: null, revisedTime: null, capacity: null, pickup: '' }
  // Extraction may leave the date/direction unresolved; publication uses the stricter validator.
  const validExtractionDraft = draft && validDraft({ ...draft, serviceDate: draft.serviceDate === '' ? '2000-01-01' : draft.serviceDate,
    changes: Array.isArray(draft.changes) && draft.changes.length === 0 ? [sample] : draft.changes })
  if (!object(value) || !keys(value, ['draft', 'unresolved', 'evidence']) || !validExtractionDraft
    || !Array.isArray(value.unresolved) || value.unresolved.length > 20 || !value.unresolved.every(item => text(item, 200, true))
    || !Array.isArray(value.evidence) || value.evidence.length > 20 || !value.evidence.every(item => text(item, 300, true))) throw new Error('AI could not read a complete update. Add clearer details to the message and try again.')
  return value as Extraction
}

export const outlooks = ['compare_both', 'shuttle_worth_considering', 'grab_worth_reviewing', 'insufficient_information'] as const
export const cautionCodes = ['estimate_only', 'queue_may_be_stale', 'unknown_delay', 'limited_space', 'data_unavailable'] as const
export type JourneyAdvice = { outlook: typeof outlooks[number]; explanation: string; evidenceIds: string[]; cautionCodes: typeof cautionCodes[number][] }
export function parseAdvice(value: unknown, allowedIds: string[]): JourneyAdvice {
  if (!object(value) || !keys(value, ['outlook', 'explanation', 'evidenceIds', 'cautionCodes'])
    || !outlooks.includes(value.outlook as JourneyAdvice['outlook']) || !text(value.explanation, 400, true)
    || /[\p{N}<>\r\n]/u.test(value.explanation as string)
    || !Array.isArray(value.evidenceIds) || value.evidenceIds.length > 20 || !value.evidenceIds.every(id => typeof id === 'string' && allowedIds.includes(id))
    || !Array.isArray(value.cautionCodes) || value.cautionCodes.length > cautionCodes.length
    || !value.cautionCodes.every(code => cautionCodes.includes(code as JourneyAdvice['cautionCodes'][number]))) throw new Error('AI advice is unavailable.')
  return value as JourneyAdvice
}
