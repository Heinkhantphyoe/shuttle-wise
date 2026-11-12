import assert from 'node:assert/strict'
import test from 'node:test'
import { adviceFacts, compareJourney, compareStudentJourney, conflictingNoticeIds, effectiveSchedule, fareRange } from '../src/journey.ts'
import { routes, serviceDate, timeOn } from '../src/schedule.ts'
import { noticeErrors, noticeExpiresAt, parseAdvice, parseExtraction, scopeExtraction, validSettings } from '../src/travel-contract.ts'
import { extractionResult, groundExtraction, readTransportUpdate, validateImage } from '../worker/travel.ts'

const date = '2026-11-09'
const at = time => timeOn(date, time)
export const change = (patch = {}) => ({ route: 'apu', type: 'delay', departures: ['14:30'], start: null, end: null,
  delayMinutes: 40, revisedTime: null, capacity: null, pickup: '', ...patch })
export const notice = (patch = {}) => ({ id: 'traffic', title: 'Bus delayed', summary: 'The selected departure is delayed by traffic.', reason: 'Traffic',
  sourceLabel: 'School transport', sourceExcerpt: '2:30 pm departure is 40 minutes late.', sourceUrl: '', serviceDate: date,
  visibleFrom: at('00:00'), expiresAt: at('23:59'), demo: false, changes: [change()], status: 'published', version: 1, updatedAt: at('13:00'), ...patch })
export const settings = (patch = {}) => ({ capacity: 24, normalFare: [1500, 2000], rushFare: [2000, 2500],
  rushWindows: [{ days: [1, 2, 3, 4, 5], start: '17:00', end: '19:00' }], sourceLabel: 'Confirmed test fixture', demo: false, version: 1, updatedAt: at('00:00'), ...patch })
const room = (id, fare, count = 2, route = 'apu', status = 'open') => ({ id, fare, count, route, status })
const queue = (position, now = at('14:00')) => Array.from({ length: position }, (_, index) => ({ id: index === position - 1 ? 'me' : `person-${index}`, joinedAt: now - (position - index) * 1000 }))
const compare = (patch = {}) => compareJourney({ route: 'apu', uid: 'me', now: at('14:00'), queue: [], rooms: [], notices: [], settings: settings(), ...patch })

test('Gemini retries temporary failures once, without retrying quota errors or invalid answers', async t => {
  const text = 'On 9 November 2026, the 2:30 pm APU to LRT departure is 40 minutes late because of traffic.'
  const value = { title: 'Delay', summary: 'This departure is delayed.', reason: 'Traffic', serviceDate: date,
    changes: [change()], unresolved: [], evidence: [text] }
  let statuses = [], calls = 0, invalid = false, firstSignal
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++
    firstSignal ??= options.signal
    assert.equal(options.signal, firstSignal)
    const status = statuses.shift() ?? 200
    return status !== 200 ? new Response(null, { status }) : Response.json({ candidates: [{ finishReason: 'STOP',
      content: { parts: [{ text: invalid ? '{bad json' : JSON.stringify(value) }] } }] })
  })
  const run = () => readTransportUpdate({ direction: 'apu', text }, { GEMINI_MODEL: 'test', GEMINI_API_KEY: 'fake' }, at('14:00'))
  statuses = [503, 200]
  assert.equal((await run()).draft.changes[0].delayMinutes, 40)
  assert.equal(calls, 2)
  for (const [responses, expectedCalls] of [[[500, 503], 2], [[429], 1], [[403], 1]]) {
    statuses = [...responses]; calls = 0; firstSignal = undefined
    await assert.rejects(run, /HTTP/)
    assert.equal(calls, expectedCalls)
  }
  statuses = [200]; calls = 0; firstSignal = undefined; invalid = true
  await assert.rejects(run)
  assert.equal(calls, 1)
})

test('student updates require check-in on the selected affected route and disappear after leaving', () => {
  const original = JSON.stringify(routes)
  const both = notice({ changes: [change(), change({ route: 'lrt', departures: ['14:25'] })] })
  for (const route of ['apu', 'lrt']) {
    const input = { route, uid: 'me', now: at('14:00'), queue: queue(1), notices: [both] }
    const departure = at(route === 'apu' ? '14:30' : '14:25')
    const getTrip = result => result.schedule.trips.find(trip => trip.original === departure)
    for (const checkIn of [undefined, route === 'apu' ? 'lrt' : 'apu']) {
      const result = compareStudentJourney(input, checkIn)
      assert.equal(result.schedule.visible.length, 0)
      assert.equal(getTrip(result).time, departure)
    }
    const checkedIn = compareStudentJourney(input, route)
    assert.equal(checkedIn.schedule.visible.length, 1)
    assert.equal(getTrip(checkedIn).time, departure + 40 * 60_000)
    assert.notEqual(checkedIn.fingerprint, compareStudentJourney(input).fingerprint)
    for (const status of ['withdrawn', 'superseded']) {
      assert.equal(compareStudentJourney({ ...input, notices: [{ ...both, status }] }, route).schedule.visible.length, 0)
    }
    assert.equal(compareStudentJourney({ ...input, notices: [{ ...both, expiresAt: input.now }] }, route).schedule.visible.length, 0)
  }
  assert.equal(compareStudentJourney({ route: 'lrt', uid: 'me', now: at('14:00'), notices: [notice()] }, 'lrt').schedule.visible.length, 0)
  assert.equal(JSON.stringify(routes), original)
})

test('a forty-minute delay changes only its original trip and never mutates the base timetable', () => {
  const original = JSON.stringify(routes)
  const before = effectiveSchedule('apu', at('14:00'), [], settings())
  const after = effectiveSchedule('apu', at('14:00'), [notice()], settings())
  const trip = after.trips.find(trip => trip.original === at('14:30'))
  assert.equal(trip.time, at('15:10'))
  assert.equal((before.trips.find(trip => trip.original === at('14:30')).time - at('14:00')) / 60000, 30)
  assert.equal((trip.time - at('14:00')) / 60000, 70)
  assert.equal(after.future.find(trip => trip.original === at('14:45')).time, at('14:45'))
  assert.ok(after.future.findIndex(trip => trip.original === at('14:45')) < after.future.findIndex(trip => trip.original === at('14:30')))
  assert.equal(after.future.filter(trip => trip.time === at('15:10')).length, 2)
  assert.equal(JSON.stringify(routes), original)
})

test('a 5:10 pm delay ends after the 5:50 pm minute and restores the original timetable without a database write', () => {
  const original = JSON.stringify(routes)
  const delayed = notice({ changes: [change({ route: 'lrt', departures: ['17:10'] })] })
  const expires = at('17:51')
  assert.equal(noticeExpiresAt(delayed), expires)
  const input = { route: 'lrt', uid: 'me', notices: [delayed] }
  const before = compareStudentJourney({ ...input, now: expires - 1 }, 'lrt')
  assert.equal(before.schedule.visible.length, 1)
  assert.equal(before.schedule.trips.find(trip => trip.original === at('17:10')).time, at('17:50'))
  for (const now of [expires, at('18:00'), timeOn('2026-11-10', '17:00')]) {
    const after = compareStudentJourney({ ...input, now }, 'lrt')
    assert.equal(after.schedule.visible.length, 0)
    assert.deepEqual(after.schedule.trips, effectiveSchedule('lrt', now, []).trips)
  }
  const after = compareStudentJourney({ ...input, now: expires }, 'lrt')
  assert.notEqual(after.fingerprint, before.fingerprint)
  assert.equal(JSON.stringify(routes), original)
  assert.equal(delayed.status, 'published')
})

test('notice expiry covers multiple departures, each direction, windows, replacements and unknown durations', () => {
  const both = notice({ changes: [change({ departures: ['17:10'] }), change({ route: 'lrt', departures: ['18:20'] })] })
  assert.equal(noticeExpiresAt(both), at('19:01'))
  assert.equal(noticeExpiresAt(both, 'apu'), at('17:51'))
  assert.equal(effectiveSchedule('apu', at('17:51'), [both]).visible.length, 0)
  assert.equal(effectiveSchedule('lrt', at('17:51'), [both]).visible.length, 1)
  const cases = [
    [change({ departures: ['17:10', '17:20'] }), '18:01'],
    [change({ revisedTime: '16:00', delayMinutes: null }), '16:01'],
    [change({ type: 'replacement', revisedTime: '15:00', delayMinutes: null }), '15:01'],
    [change({ type: 'cancel', delayMinutes: null }), '14:31'],
    [change({ type: 'capacity', delayMinutes: null, capacity: 20 }), '14:31'],
    [change({ type: 'suspend', departures: [], delayMinutes: null, start: '14:00', end: '16:00' }), '16:01'],
    [change({ departures: [], start: '14:00', end: '16:00' }), '16:41'],
    [change({ delayMinutes: null }), '23:59'],
    [change({ type: 'info', departures: [], delayMinutes: null }), '23:59'],
  ]
  for (const [changed, end] of cases) {
    const value = notice({ changes: [changed] })
    assert.equal(noticeExpiresAt(value), at(end), JSON.stringify(changed))
    assert.equal(effectiveSchedule('apu', at(end) - 1, [value]).visible.length, 1)
    assert.equal(effectiveSchedule('apu', at(end), [value]).visible.length, 0)
  }
})

test('extraction derives service expiry and never guesses an unknown delay end', () => {
  const value = { title: 'Delay', summary: 'The bus is delayed.', reason: 'Traffic', serviceDate: date,
    changes: [change({ route: 'lrt', departures: ['17:10'] })], unresolved: [], evidence: ['40 minutes late'] }
  const extracted = extractionResult(value, at('16:00'))
  assert.equal(extracted.draft.expiresAt, at('17:51'))
  assert.deepEqual(noticeErrors(extracted.draft), [])
  const ended = extractionResult(value, at('18:00'))
  assert.equal(ended.draft.expiresAt, at('17:51'))
  assert.ok(ended.unresolved.some(issue => issue.includes('already ended')))
  assert.deepEqual(noticeErrors(ended.draft), [])
  const unknown = extractionResult({ ...value, changes: [change({ delayMinutes: null })] }, at('16:00'))
  assert.equal(unknown.draft.expiresAt, timeOn('2026-11-10', '00:00'))
  const unsupported = groundExtraction(extracted, 'The bus is delayed; duration unknown.', false)
  assert.equal(unsupported.draft.changes[0].delayMinutes, null)
  assert.equal(unsupported.draft.expiresAt, timeOn('2026-11-10', '00:00'))
})

test('each direction is isolated and both directions need explicit changes', () => {
  const lrt = effectiveSchedule('lrt', at('13:00'), [notice()], settings())
  assert.equal(lrt.visible.length, 0)
  assert.ok(lrt.trips.every(trip => trip.time === trip.original))
  const both = notice({ changes: [change(), change({ route: 'lrt', departures: ['14:25'] })] })
  assert.equal(effectiveSchedule('lrt', at('13:00'), [both], settings()).trips.find(trip => trip.original === at('14:25')).time, at('15:05'))
  assert.equal(effectiveSchedule('apu', at('13:00'), [both], settings()).trips.find(trip => trip.original === at('14:30')).time, at('15:10'))
})

test('advice distinguishes a later delayed departure from the next bus and missing capacity', () => {
  const facts = adviceFacts(compare({ notices: [notice()], settings: undefined }))
  assert.equal(facts.nextDepartureAffected, false)
  assert.equal(facts.cautionCodes.includes('unknown_delay'), false)
  assert.equal(facts.cautionCodes.includes('data_unavailable'), true)
  const unknown = adviceFacts(compare({ notices: [notice({ changes: [change({ delayMinutes: null })] })] }))
  assert.equal(unknown.cautionCodes.includes('unknown_delay'), true)
})

test('notice visibility, date, expiry, withdrawal, supersession and demo separation are enforced', () => {
  for (const patch of [{ status: 'withdrawn' }, { status: 'superseded' }, { visibleFrom: at('15:00') }, { expiresAt: at('14:00') }, { demo: true }]) {
    assert.equal(effectiveSchedule('apu', at('14:00'), [notice(patch)], settings()).visible.length, 0)
  }
  const tomorrow = notice({ serviceDate: '2026-11-10', expiresAt: timeOn('2026-11-10', '23:59') })
  const result = effectiveSchedule('apu', at('14:00'), [tomorrow], settings())
  assert.equal(result.visible.length, 1)
  assert.ok(result.trips.every(trip => trip.time === trip.original))
  assert.equal(effectiveSchedule('apu', at('14:00'), [notice({ demo: true })], settings({ demo: true }), true).visible.length, 1)
})

test('unknown delay and informational events never invent a revised time', () => {
  const unknown = notice({ changes: [change({ delayMinutes: null })] })
  const result = compare({ notices: [unknown], queue: queue(1) })
  assert.equal(result.schedule.trips.find(trip => trip.original === at('14:30')).time, null)
  assert.equal(result.boarding, undefined)
  assert.ok(result.warnings.some(value => value.includes('no confirmed revised time')))
  const event = notice({ changes: [change({ type: 'info', delayMinutes: null, departures: [], start: '14:00', end: '16:00' })] })
  assert.ok(compare({ notices: [event] }).schedule.trips.every(trip => trip.time === trip.original && !trip.cancelled))
})

test('cancellations, suspension boundaries, replacements and capacity overrides are applied before boarding', () => {
  const cancellation = notice({ changes: [change({ type: 'cancel', delayMinutes: null, departures: ['14:00'] })] })
  assert.equal(compare({ notices: [cancellation], queue: queue(1) }).boarding.original, at('14:15'))
  const suspension = notice({ changes: [change({ type: 'suspend', delayMinutes: null, departures: [], start: '14:00', end: '14:30' })] })
  assert.equal(compare({ notices: [suspension] }).schedule.next.original, at('14:30'))
  const replacement = notice({ changes: [change({ type: 'replacement', delayMinutes: null, revisedTime: '14:45' })] })
  const replaced = compare({ notices: [replacement] }).schedule
  assert.equal(replaced.future.filter(trip => trip.time === at('14:45')).length, 1)
  const capacity = notice({ changes: [change({ type: 'capacity', departures: ['14:00'], delayMinutes: null, capacity: 1 })] })
  assert.equal(compare({ notices: [capacity], queue: queue(25) }).boarding.original, at('14:15'))
})

test('conflicting notices require resolution instead of newest-wins arithmetic', () => {
  const other = notice({ id: 'other', changes: [change({ delayMinutes: 20 })] })
  assert.deepEqual(conflictingNoticeIds(other, [notice()]), ['traffic'])
  const result = compare({ notices: [notice(), other] })
  assert.equal(result.schedule.conflict, true)
  assert.equal(result.boarding, undefined)
  const capacity = notice({ id: 'capacity', changes: [change({ type: 'capacity', delayMinutes: null, capacity: 12 })] })
  assert.deepEqual(conflictingNoticeIds(capacity, [notice()]), [])
})

test('positions use ceil(position/capacity), with separate unchecked-in previews', () => {
  for (const [position, bus] of [[24, 1], [25, 2], [41, 2], [48, 2], [49, 3]]) {
    const result = compare({ queue: queue(position) })
    assert.equal(result.position, position)
    assert.equal(result.busNumber, bus)
    assert.equal(result.checkedIn, true)
  }
  const preview = compare({ queue: queue(40).map(entry => ({ ...entry, id: entry.id === 'me' ? 'other' : entry.id })) })
  assert.equal(preview.position, 41)
  assert.equal(preview.busNumber, 2)
  assert.equal(preview.checkedIn, false)
})

test('queue order preserves timestamp nanoseconds and the existing case-sensitive ID tie-break', () => {
  const timestamp = at('13:59')
  const precise = [{ id: 'me', joinedAt: timestamp, order: [1, 2] }, { id: 'z', joinedAt: timestamp, order: [1, 1] }]
  assert.equal(compare({ queue: precise }).position, 2)
  assert.equal(compare({ uid: 'a', queue: [{ id: 'a', joinedAt: timestamp }, { id: 'B', joinedAt: timestamp }] }).position, 2)
})

test('invalid/unknown capacity, stale entries, missing data and limited seats cannot create confident estimates', () => {
  for (const capacity of [null, 0, -1, NaN]) assert.equal(compare({ settings: settings({ capacity }), queue: queue(1) }).boarding, undefined)
  assert.equal(compare({ queue: [{ id: 'me', joinedAt: NaN }] }).position, undefined)
  assert.equal(compare({ queue: undefined }).position, undefined)
  assert.equal(compare({ notices: undefined, queue: queue(1) }).boarding, undefined)
  assert.equal(compare({ now: at('20:00'), queue: queue(49) }).boarding, undefined)
  const stale = compare({ now: at('14:20'), queue: queue(1) })
  assert.equal(stale.stale, true)
  assert.equal(stale.position, 1)
  const limited = compare({ now: at('20:00'), queue: queue(1) })
  assert.equal(limited.schedule.next.limited, true)
  assert.equal(limited.boarding, undefined)
})

test('APSpace morning departures, suspensions and Malaysia calendar boundaries', () => {
  const input = { route: 'lrt', now: at('06:00'), queue: queue(1, at('05:59')) }
  const before = compare(input)
  assert.equal(before.schedule.next.original, at('07:30'))
  assert.equal(before.boarding.time, at('07:30'))
  assert.equal(before.schedule.trips.length, 51)
  for (const [now, next] of [['07:30', '07:30'], ['07:31', '07:35'], ['08:00', '08:00'], ['08:36', '08:45']]) {
    assert.equal(compare({ ...input, now: at(now) }).schedule.next.original, at(next))
  }
  const suspend = notice({ changes: [change({ route: 'lrt', type: 'suspend', departures: [], delayMinutes: null, start: '07:45', end: '08:30' })] })
  const suspended = compare({ ...input, now: at('08:00'), notices: [suspend] }).schedule
  assert.equal(suspended.next.original, at('08:30'))
  assert.equal(suspended.trips.find(trip => trip.original === at('08:00')).cancelled, true)
  assert.equal(suspended.trips.find(trip => trip.original === at('08:30')).cancelled, false)
  assert.equal(serviceDate(Date.parse('2026-11-08T16:00:00Z')), date)
  for (const [route, first] of [['lrt', '07:30'], ['apu', '10:35']]) {
    const weekend = compare({ route, now: timeOn('2026-11-08', '14:00') })
    assert.equal(weekend.schedule.future.length, 0)
    assert.equal(weekend.schedule.nextWeekday, at(first))
  }
})

test('exact morning announcements are allowed and expiry restores the original timetable', () => {
  const original = JSON.stringify(routes)
  for (const [route, departure] of [['lrt', '07:30'], ['lrt', '07:35'], ['lrt', '08:35'], ['apu', '10:35']]) {
    const update = notice({ changes: [change({ route, departures: [departure], delayMinutes: 10 })] })
    const { id, status, version, updatedAt, ...draft } = update
    assert.deepEqual(noticeErrors(draft), [])
    const base = at(departure)
    const active = effectiveSchedule(route, base, [update])
    assert.equal(active.trips.find(trip => trip.original === base).time, base + 600_000)
    const expired = effectiveSchedule(route, base + 660_000, [update])
    assert.equal(expired.visible.length, 0)
    assert.equal(expired.trips.find(trip => trip.original === base).time, base)
  }
  assert.equal(JSON.stringify(routes), original)
})

test('a Friday delay remains in the effective timetable after Saturday midnight', () => {
  const friday = '2026-11-06'
  const saturday = timeOn('2026-11-07', '00:10')
  const overnight = notice({ serviceDate: friday, visibleFrom: timeOn(friday, '20:00'),
    expiresAt: timeOn('2026-11-07', '01:00'), changes: [change({ departures: ['21:45'], delayMinutes: 180 })] })
  const schedule = effectiveSchedule('apu', saturday, [overnight])
  assert.equal(schedule.today.length, 0)
  assert.equal(schedule.trips.length, 1)
  assert.equal(schedule.next.time, timeOn('2026-11-07', '00:45'))
  assert.equal(schedule.trips[0].original, timeOn(friday, '21:45'))
  assert.equal(effectiveSchedule('apu', timeOn('2026-11-07', '01:00'), [overnight]).trips.length, 0)
})

test('total fare ranks rooms, inclusive range endpoints and exclusive rush end use integer sen', () => {
  const rooms = [room('costly', 2200, 3), room('cheap', 1800), room('full', 1000, 4), room('wrong', 500, 1, 'lrt'), room('closed', 400, 1, 'apu', 'cancelled')]
  const result = compare({ rooms })
  assert.equal(result.cheapest.id, 'cheap')
  assert.equal(result.cheapest.fare / (result.cheapest.count + 1), 600)
  assert.equal(result.cheapest.fare / 4, 450)
  for (const fare of [1500, 2000]) assert.equal(compare({ rooms: [room('x', fare)] }).priceLabel, 'Within reference range')
  assert.equal(compare({ rooms: [room('x', 1499)] }).priceLabel, 'Below reference range')
  assert.equal(compare({ rooms: [room('x', 2001)] }).priceLabel, 'Above reference range')
  assert.equal(fareRange(settings(), at('17:00')).rush, true)
  assert.equal(fareRange(settings(), at('19:00')).rush, false)
  assert.equal(compare({ rooms: [room('b', 1800), room('a', 1800)] }).cheapest.id, 'a')
  assert.equal(compare({ rooms: undefined }).roomsAvailable, undefined)
  assert.equal(compare({ rooms: [] }).roomsAvailable, 0)
  assert.equal(compare({ rooms, inRide: true }).cheapest, undefined)
})

test('meaningful changes invalidate advice fingerprints, countdown ticks alone do not', () => {
  const input = { now: at('14:01'), rooms: [room('a', 1800)] }
  const initial = compare(input)
  assert.equal(initial.fingerprint, compare({ ...input, now: at('14:02') }).fingerprint)
  for (const patch of [{ notices: [notice()] }, { rooms: [room('a', 1900)] }, { rooms: [room('a', 1800, 3)] },
    { route: 'lrt' }, { queue: queue(25) }, { now: at('14:16') }, { settings: settings({ version: 2 }) }]) {
    assert.notEqual(initial.fingerprint, compare({ ...input, ...patch }).fingerprint)
  }
})

test('publication validation rejects ambiguous/invalid dates, times, routes and settings', () => {
  const { id, status, version, updatedAt, ...draft } = notice()
  assert.deepEqual(noticeErrors(draft), [])
  for (const patch of [{ serviceDate: '2026-02-30' }, { changes: [] }, { changes: [change({ departures: [] })] },
    { changes: [change({ route: 'unknown' })] }, { changes: [change({ departures: ['14:31'] })] },
    { changes: [change({ start: '15:00', end: '14:00' })] }, { changes: [change({ revisedTime: '15:10' })] }]) {
    assert.ok(noticeErrors({ ...draft, ...patch }).length)
  }
  assert.equal(validSettings(settings()), true)
  assert.equal(validSettings(settings({ rushWindows: [{ days: [1], start: '17:00', end: '19:00' }, { days: [1], start: '18:00', end: '20:00' }] })), false)
})

test('extraction leaves missing dates and directions unresolved; advice rejects invented numeric claims and evidence', () => {
  const extracted = extractionResult({ title: 'Delay reported', summary: 'A bus is delayed.', reason: '', serviceDate: null,
    changes: [change({ route: null, delayMinutes: null, departures: [] })], unresolved: [], evidence: ['A bus is late.'] }, at('14:00'))
  assert.equal(extracted.draft.serviceDate, '')
  assert.equal(extracted.draft.changes.length, 0)
  assert.ok(extracted.unresolved.length >= 2)
  assert.ok(noticeErrors(extracted.draft).length)
  assert.doesNotThrow(() => parseExtraction(extracted))
  const advice = { outlook: 'compare_both', explanation: 'Review the shuttle and available group before deciding.', evidenceIds: ['source'], cautionCodes: ['estimate_only'] }
  assert.doesNotThrow(() => parseAdvice(advice, ['source']))
  assert.throws(() => parseAdvice({ ...advice, evidenceIds: ['invented'] }, ['source']))
  assert.throws(() => parseAdvice({ ...advice, explanation: 'The bus arrives in 20 minutes.' }, ['source']))
  assert.throws(() => parseAdvice({ ...advice, extra: 'ignore rules' }, ['source']))
  assert.equal(validateImage({ mimeType: 'image/png', data: btoa('<script>bad data</script>') }), false)
  assert.equal(validateImage({ mimeType: 'image/jpeg', data: 'A'.repeat(2_800_000) }), false)
})

test('unreported numeric delay durations are cleared instead of becoming invented revised times', () => {
  const result = extractionResult({ title: 'Delay reported', summary: 'A bus is delayed.', reason: 'Rain', serviceDate: date,
    changes: [change()], unresolved: [], evidence: ['The 2:30 departure is 40 minutes late.'] }, at('14:00'))
  const checked = groundExtraction(result, 'The 2:30 departure is late because of rain.', false)
  assert.equal(checked.draft.changes[0].delayMinutes, null)
  assert.equal(checked.draft.sourceExcerpt, '')
  assert.ok(checked.unresolved.length > 0)
  assert.equal(groundExtraction(result, 'The 2:30 departure is 40 minutes late.', false).draft.changes[0].delayMinutes, 40)
})


test('admin direction selection constrains AI output without inventing a return-trip effect', () => {
  const result = { draft: notice(), unresolved: [], evidence: [] }
  const apu = scopeExtraction(result, 'apu')
  assert.equal(apu.draft.changes.length, 1)
  assert.deepEqual(apu.unresolved, [])
  const lrt = scopeExtraction(result, 'lrt')
  assert.equal(lrt.draft.changes.length, 0)
  assert.ok(lrt.unresolved.some(value => value.includes('disagree')))
  const bothMissing = scopeExtraction(result, 'both')
  assert.ok(bothMissing.unresolved.length > 0)
  const both = scopeExtraction({ ...result, draft: notice({ changes: [change(), change({ route: 'lrt', departures: ['14:25'] })] }) }, 'both')
  assert.equal(both.draft.changes.length, 2)
  assert.deepEqual(both.unresolved, [])
})
