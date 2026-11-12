import assert from 'node:assert/strict'
import test from 'node:test'
import { scheduleFor, routes } from '../src/schedule.ts'
import { confirmPickup, withinPickup } from '../src/pickup.ts'
import { summarize } from '../src/trends.ts'
import { parseGuidance, tryProviders, validAIRequest } from '../src/ai-contract.ts'

const timestamp = value => Date.parse(value + '+08:00')

test('both timetables are sorted and have the expected ranges', () => {
  for (const [route, count, first, last] of [['apu', 39, '10:35', '21:45'], ['lrt', 51, '07:30', '18:20']]) {
    const { departures } = routes[route]
    assert.equal(new Set(departures).size, count)
    assert.equal(departures.length, count)
    assert.deepEqual(departures, [...departures].sort())
    assert.equal(departures[0], first)
    assert.equal(departures.at(-1), last)
    const friday = scheduleFor(route, timestamp('2026-11-06T06:00:00'))
    assert.equal(friday.next, timestamp(`2026-11-06T${first}:00`))
    for (const now of ['2026-11-06T23:59:00', '2026-11-07T00:00:00', '2026-11-08T23:59:00']) {
      const schedule = scheduleFor(route, timestamp(now))
      assert.equal(schedule.next, undefined)
      assert.equal(schedule.today.length, now.startsWith('2026-11-06') ? count : 0)
      assert.equal(schedule.nextWeekday, timestamp(`2026-11-09T${first}:00`))
    }
  }
})

// Independent transcription of the two APSpace screenshots supplied by the user.
test('every departure matches the APSpace screenshots in both directions', () => {
  const expected = {
    lrt: `07:30 07:35 07:40 07:50 07:55 08:00 08:05 08:15
      08:20 08:25 08:30 08:35 08:45 09:00 09:10 09:20
      09:30 09:50 10:00 10:05 10:10 10:15 10:30 10:35
      10:45 11:00 11:05 11:10 11:25 11:40 12:10 12:30
      12:45 13:00 13:15 13:20 13:25 13:40 14:10 14:25
      14:40 15:05 15:20 15:40 15:55 16:10 16:25 17:10
      17:20 17:30 18:20`,
    apu: `10:35 10:45 11:30 11:50 12:10 12:35 12:50 13:05
      13:10 13:15 13:30 14:00 14:15 14:30 14:45 15:10
      15:20 15:30 15:45 15:50 16:00 16:15 16:30 16:45
      16:50 17:00 17:10 17:20 17:30 17:40 18:00 18:10
      18:15 18:30 18:40 18:55 19:15 20:45 21:45`,
  }
  for (const route of ['lrt', 'apu']) assert.deepEqual(routes[route].departures, expected[route].split(/\s+/))
})

test('pickup validation rejects poor accuracy and readings outside the selected pickup', () => {
  const point = { latitude: 3, longitude: 101 }
  assert.equal(withinPickup(point, { ...point, accuracy: 50 }), true)
  assert.equal(withinPickup(point, { ...point, accuracy: 35 }), true)
  assert.equal(withinPickup(point, { ...point, accuracy: 50.01 }), false)
  assert.equal(withinPickup(point, { ...point, latitude: 3.00046, accuracy: 1 }), false)
  assert.equal(withinPickup(point, { ...point, latitude: 3.00044, accuracy: 1 }), true)
})

test('check-in requests a fresh reading and rejects denied or timed-out location', async t => {
  const point = { latitude: 3, longitude: 101 }
  const lrt = { latitude: 3.05, longitude: 101.7 }
  let result = { coords: { ...point, accuracy: 35 } }
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition(success, failure, options) {
      assert.deepEqual(options, { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 })
      if ('code' in result) failure(result)
      else success(result)
    },
  } })
  t.after(() => delete navigator.geolocation)
  await confirmPickup(point)
  await assert.rejects(confirmPickup(lrt), /within 50 metres/)
  result = { coords: { ...lrt, accuracy: 10 } }
  await confirmPickup(lrt)
  await assert.rejects(confirmPickup(point), /within 50 metres/)
  result = { coords: { ...lrt, accuracy: 51 } }
  await assert.rejects(confirmPickup(lrt), /reported accuracy: 51 metres/)
  result = { code: 1 }
  await assert.rejects(confirmPickup(point), /denied/)
  result = { code: 3 }
  await assert.rejects(confirmPickup(point), /timed out/)
})

test('history separates periods and computes the peak in Malaysia time', () => {
  const now = timestamp('2026-11-06T12:00:00')
  const events = ['2026-11-05T08:00:00', '2026-11-06T08:15:00', '2026-11-06T09:00:00',
    '2026-10-30T08:00:00', '2026-11-06T13:00:00'].map(timestamp)
  assert.deepEqual(summarize(events, now).metrics, { current: 3, previous: 1, peakHour: 8, peakCount: 2 })
})

const routeMetrics = { current: 5, previous: 10, peakHour: 7, peakCount: 3 }
const briefing = { kind: 'briefing', metrics: { apu: routeMetrics, lrt: routeMetrics } }

test('AI only accepts numeric briefing metrics and rejects malformed or numeric guidance', () => {
  const request = briefing
  assert.equal(validAIRequest(request), true)
  assert.equal(validAIRequest({ ...request, metrics: { ...request.metrics, latitude: 3 } }), false)
  assert.equal(parseGuidance('{"guidance":"Stay near the pickup."}'), 'Stay near the pickup.')
  assert.throws(() => parseGuidance('{"guidance":"Wait 20 minutes."}'))
  assert.throws(() => parseGuidance('Service unavailable'))
})

test('provider failures try the backup once with the same metrics', async () => {
  const request = briefing
  const calls = []
  const primary = async input => { calls.push(['primary', input]); return parseGuidance('invalid') }
  const backup = async input => { calls.push(['backup', input]); return 'Stay near the pickup.' }
  assert.equal(await tryProviders(request, primary, backup), 'Stay near the pickup.')
  assert.deepEqual(calls, [['primary', request], ['backup', request]])
  calls.length = 0
  const unavailable = async input => { calls.push(['backup', input]); throw new Error('Service unavailable') }
  assert.equal(await tryProviders(request, primary, unavailable), undefined)
  assert.deepEqual(calls, [['primary', request], ['backup', request]])
})
