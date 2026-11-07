// Opt-in real Gemini checks. Sends only the public test inputs below, never Firebase records.
import assert from 'node:assert/strict'
import { loadEnvFile } from 'node:process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { readTransportUpdate, explainJourney } from '../worker/travel.ts'
import { compareJourney, effectiveSchedule } from '../src/journey.ts'
import { routes, timeOn } from '../src/schedule.ts'
import { noticeErrors } from '../src/travel-contract.ts'

try { loadEnvFile(new URL('../worker/.dev.vars', import.meta.url)) } catch { /* A shell secret also works. */ }
const config = JSON.parse(await readFile(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8'))
const env = { ...config.vars, GEMINI_API_KEY: process.env.GEMINI_API_KEY }
if (!env.GEMINI_API_KEY) throw new Error('Add GEMINI_API_KEY to the ignored worker/.dev.vars file first.')
const date = '2026-11-09'
const now = timeOn(date, '14:00')
const original = JSON.stringify(routes)
const results = []
const reportUrl = new URL('../output/ai-live-validation/', import.meta.url)
let delayedNotice

async function check(name, run) {
  const started = Date.now()
  try {
    const detail = await run()
    results.push({ name, passed: true, milliseconds: Date.now() - started, detail })
    console.log(`PASS ${name}`)
  } catch (error) {
    const message = String(error.message).split(env.GEMINI_API_KEY).join('[REDACTED]')
    results.push({ name, passed: false, milliseconds: Date.now() - started, error: message })
    console.error(`FAIL ${name}: ${message}`)
    process.exitCode = 1
  }
}

function publishFixture(extracted) {
  assert.deepEqual(extracted.unresolved, [])
  assert.deepEqual(noticeErrors(extracted.draft), [])
  return { ...extracted.draft, id: 'test-delay', status: 'published', version: 1, updatedAt: now }
}

await check('APU direction: real extraction and 30 → 70 minute countdown', async () => {
  const result = await readTransportUpdate({ direction: 'apu', text:
    'On 9 November 2026, the 2:30 pm APU to Bukit Jalil LRT departure is 40 minutes late because of traffic.' }, env, now)
  delayedNotice = publishFixture(result)
  assert.equal(result.draft.changes.length, 1)
  const schedule = effectiveSchedule('apu', now, [delayedNotice])
  const trip = schedule.trips.find(trip => trip.original === timeOn(date, '14:30'))
  assert.equal(trip.time, timeOn(date, '15:10'))
  assert.equal((trip.time - now) / 60_000, 70)
  assert.ok(schedule.future.findIndex(trip => trip.original === timeOn(date, '14:45'))
    < schedule.future.findIndex(trip => trip.original === timeOn(date, '14:30')))
  assert.ok(effectiveSchedule('lrt', now, [delayedNotice]).trips.every(trip => trip.time === trip.original))
  return result
})

await check('LRT direction: image extraction with a real PNG', async () => {
  const data = await readFile(new URL('../tests/fixtures/transport-notice.png', import.meta.url))
  const result = await readTransportUpdate({ direction: 'lrt', text: '', image: { mimeType: 'image/png', data: data.toString('base64') } }, env, now)
  const notice = publishFixture(result)
  assert.equal(notice.changes.length, 1)
  assert.equal(notice.changes[0].route, 'lrt')
  assert.equal(notice.changes[0].delayMinutes, 20)
  const trip = effectiveSchedule('lrt', now, [notice]).trips.find(trip => trip.original === timeOn(date, '14:25'))
  assert.equal(trip.time, timeOn(date, '14:45'))
  return result
})

await check('Both directions: separate affected departures', async () => {
  const result = await readTransportUpdate({ direction: 'both', text:
    'On 9 November 2026, due to traffic, the 2:30 pm APU to Bukit Jalil LRT departure is 40 minutes late. The 2:25 pm Bukit Jalil LRT to APU departure is 20 minutes late because of heavy rain.' }, env, now)
  const notice = publishFixture(result)
  assert.equal(notice.changes.length, 2)
  assert.equal(notice.changes.find(change => change.route === 'apu').delayMinutes, 40)
  assert.equal(notice.changes.find(change => change.route === 'lrt').delayMinutes, 20)
  return result
})

await check('Unknown delay: no invented duration or revised time', async () => {
  const result = await readTransportUpdate({ direction: 'apu', text:
    'On 9 November 2026, the 2:30 pm APU to Bukit Jalil LRT departure is delayed because of heavy rain. The delay duration and revised departure time are unknown.' }, env, now)
  const notice = publishFixture(result)
  assert.equal(notice.changes[0].delayMinutes, null)
  assert.equal(notice.changes[0].revisedTime, null)
  assert.equal(effectiveSchedule('apu', now, [notice]).trips.find(trip => trip.original === timeOn(date, '14:30')).time, null)
  return result
})

for (const [name, direction, type, message, expected] of [
  ['Cancellation', 'lrt', 'cancel', 'On 9 November 2026, the 2:25 pm Bukit Jalil LRT to APU departure is cancelled because of maintenance.', { departures: ['14:25'] }],
  ['Suspension', 'lrt', 'suspend', 'On 9 November 2026, Bukit Jalil LRT to APU service is suspended from 2:00 pm to 3:00 pm because of road repairs.', { start: '14:00', end: '15:00' }],
  ['Replacement', 'apu', 'replacement', 'On 9 November 2026, replace the 2:30 pm APU to Bukit Jalil LRT departure with a 2:50 pm departure because of maintenance. This is its replacement, not an extra trip.', { departures: ['14:30'], revisedTime: '14:50' }],
  ['Pickup change', 'apu', 'pickup', 'On 9 November 2026, APU to Bukit Jalil LRT pickup moves to Gate B from 2:00 pm to 4:00 pm because of construction.', { start: '14:00', end: '16:00' }],
  ['Capacity change', 'apu', 'capacity', 'On 9 November 2026, the 2:30 pm APU to Bukit Jalil LRT departure has 12 available seats because a smaller bus is operating.', { departures: ['14:30'], capacity: 12 }],
  ['General announcement', 'apu', 'info', 'On 9 November 2026, an APU campus event runs from 2:00 pm to 4:00 pm. This is information for APU to Bukit Jalil LRT passengers because of the campus event. No shuttle times, pickup points or capacity change.', { delayMinutes: null, revisedTime: null }],
]) await check(`${name}: real extraction matches the reported change`, async () => {
  const result = await readTransportUpdate({ direction, text: message }, env, now)
  const notice = publishFixture(result)
  assert.equal(notice.changes.length, 1)
  assert.equal(notice.changes[0].type, type)
  assert.equal(notice.changes[0].route, direction)
  for (const [field, value] of Object.entries(expected)) assert.deepEqual(notice.changes[0][field], value)
  if (type === 'pickup') assert.match(notice.changes[0].pickup, /Gate B/i)
  return result
})

await check('Student explanation: real Gemini, validated evidence, calculated fare choice', async () => {
  assert.ok(delayedNotice, 'The first notice test must pass first.')
  const comparison = compareJourney({ route: 'apu', now, uid: 'test-user', queue: [], notices: [delayedNotice], rooms: [
    { id: 'test-expensive', route: 'apu', status: 'open', fare: 2200, count: 2 },
    { id: 'test-cheapest', route: 'apu', status: 'open', fare: 1800, count: 2 },
  ] })
  assert.equal(comparison.cheapest.id, 'test-cheapest')
  return explainJourney(comparison, env)
})

assert.equal(JSON.stringify(routes), original, 'Live checks must preserve the standard timetable.')
await mkdir(reportUrl, { recursive: true })
await writeFile(new URL('results.json', reportUrl), JSON.stringify({ checkedAt: new Date().toISOString(), model: env.GEMINI_MODEL,
  scope: 'Real Gemini calls through production extraction/advice functions. Public fixtures only. No deployed endpoint, Firebase access, or notice publication.', results }, null, 2) + '\n')
console.log(`${results.filter(result => result.passed).length}/${results.length} real-provider checks passed. Report: output/ai-live-validation/results.json`)
