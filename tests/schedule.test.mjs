import assert from 'node:assert/strict'
import test from 'node:test'
import { scheduleFor, routes } from '../src/schedule.ts'
import { confirmPickup, withinPickup } from '../src/pickup.ts'
import { summarize } from '../src/trends.ts'
import { parseGuidance, tryProviders, validAIRequest } from '../src/ai-contract.ts'

const timestamp = value => Date.parse(value + '+08:00')

test('both timetables are sorted and have the expected ranges', () => {
  for (const [route, count, first, last] of [['apu', 39, '10:35', '21:45'], ['lrt', 40, '07:30', '18:20']]) {
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

test('pickup validation rejects poor accuracy and readings outside the selected pickup', () => {
  const point = { latitude: 3, longitude: 101 }
  assert.equal(withinPickup(point, { ...point, accuracy: 30 }), true)
  assert.equal(withinPickup(point, { ...point, accuracy: 30.01 }), false)
  assert.equal(withinPickup(point, { ...point, latitude: 3.001, accuracy: 1 }), false)
  assert.equal(withinPickup(point, { ...point, latitude: 3.0002, accuracy: 1 }), true)
})

test('check-in requests a fresh reading and rejects denied or timed-out location', async t => {
  const point = { latitude: 3, longitude: 101 }
  const lrt = { latitude: 3.05, longitude: 101.7 }
  let result = { coords: { ...point, accuracy: 10 } }
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition(success, failure, options) {
      assert.deepEqual(options, { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 })
      if ('code' in result) failure(result)
      else success(result)
    },
  } })
  t.after(() => delete navigator.geolocation)
  await confirmPickup(point)
  await assert.rejects(confirmPickup(lrt), /within 30 metres/)
  result = { coords: { ...lrt, accuracy: 10 } }
  await confirmPickup(lrt)
  await assert.rejects(confirmPickup(point), /within 30 metres/)
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
