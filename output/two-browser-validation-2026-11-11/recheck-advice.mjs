// Public fixture only. Keep credentials in the existing ignored Worker secret file.
import { loadEnvFile } from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import { explainJourney } from '../../worker/travel.ts'
import { compareJourney } from '../../src/journey.ts'
import { timeOn } from '../../src/schedule.ts'

loadEnvFile(new URL('../../worker/.dev.vars', import.meta.url))
const config = JSON.parse(await readFile(new URL('../../worker/wrangler.jsonc', import.meta.url), 'utf8'))
const env = { ...config.vars, GEMINI_API_KEY: process.env.GEMINI_API_KEY }
const report = JSON.parse(await readFile(new URL('../ai-live-validation/results.json', import.meta.url), 'utf8'))
const now = timeOn('2026-11-09', '14:00')
const notice = { ...report.results[0].detail.draft, id: 'test-delay', status: 'published', version: 1, updatedAt: now }
const comparison = compareJourney({ route: 'apu', now, uid: 'test-user', queue: [], notices: [notice], rooms: [
  { id: 'test-expensive', route: 'apu', status: 'open', fare: 2200, count: 2 },
  { id: 'test-cheapest', route: 'apu', status: 'open', fare: 1800, count: 2 },
] })
const originalFetch = globalThis.fetch
let raw
globalThis.fetch = async (...args) => {
  const response = await originalFetch(...args)
  if (response.ok && String(args[0]).startsWith('https://generativelanguage.googleapis.com/')) {
    const result = await response.clone().json()
    raw = result.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('')
  }
  return response
}
const results = []
for (let index = 0; index < 3; index++) {
  raw = undefined
  try {
    results.push({ passed: true, advice: await explainJourney(comparison, env), raw })
  } catch (error) {
    results.push({ passed: false, error: String(error.message).split(env.GEMINI_API_KEY).join('[REDACTED]'), raw })
  }
  console.log(JSON.stringify(results.at(-1)))
}
await writeFile(new URL('advice-rechecks.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n')
if (results.some(result => !result.passed)) process.exitCode = 1
