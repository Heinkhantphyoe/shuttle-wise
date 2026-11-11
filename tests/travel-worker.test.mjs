import assert from 'node:assert/strict'
import test from 'node:test'
import { webcrypto } from 'node:crypto'
import worker from '../worker/index.ts'
import { canonicalComparison } from '../worker/travel.ts'
import { compareJourney } from '../src/journey.ts'
import { serviceDate, timeOn } from '../src/schedule.ts'

test('travel endpoints enforce App Check and admin extraction, verify canonical data, and reject invalid provider output', async t => {
  const project = 'travel-test'
  const origin = 'https://travel.example'
  const projectNumber = '12345'
  const appId = '1:12345:web:travel'
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
  const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])
  const jwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey)
  const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url')
  async function signed(payload) {
    const message = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'travel-test-key' })}.${encode(payload)}`
    const signature = await webcrypto.subtle.sign(algorithm, keys.privateKey, Buffer.from(message))
    return `${message}.${Buffer.from(signature).toString('base64url')}`
  }
  const now = Math.floor(Date.now() / 1000)
  const userToken = (uid, provider = 'anonymous') => signed({ sub: uid, aud: project, iss: `https://securetoken.google.com/${project}`,
    iat: now, auth_time: now, exp: now + 3600, firebase: { sign_in_provider: provider } })
  const appToken = await signed({ sub: appId, aud: [`projects/${projectNumber}`], iss: `https://firebaseappcheck.googleapis.com/${projectNumber}`, iat: now, exp: now + 3600 })
  const date = serviceDate(Date.now())
  let providerCalls = 0, invalid = false, invalidCaution = false, failProvider = false, denyRooms = false
  const requests = []
  let checkedInRoute
  const restValue = value => value === null ? { nullValue: null } : typeof value === 'string' ? { stringValue: value }
    : typeof value === 'number' ? { integerValue: String(value) } : typeof value === 'boolean' ? { booleanValue: value }
    : Array.isArray(value) ? { arrayValue: { values: value.map(restValue) } } : { mapValue: { fields: restFields(value) } }
  const restFields = value => Object.fromEntries(Object.entries(value).map(([key, data]) => [key, restValue(data)]))
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.startsWith('https://www.googleapis.com/') || url === 'https://firebaseappcheck.googleapis.com/v1/jwks') return Response.json({ keys: [{ ...jwk, kid: 'travel-test-key' }] })
    if (url.includes('/admins/')) return new Response(null, { status: url.endsWith('/admins/admin') ? 200 : 404 })
    if (url.startsWith('https://firestore.googleapis.com/')) {
      assert.ok(options.headers.Authorization.startsWith('Bearer '))
      if (url.endsWith(':runQuery')) {
        const query = JSON.parse(options.body).structuredQuery
        const collection = query.from[0].collectionId
        requests.push(collection)
        if (collection === 'rideListings' && denyRooms) return new Response(null, { status: 403 })
        const docs = collection === 'rideListings' ? [{ id: 'room', route: 'apu', fare: 1800, count: 2, status: 'open' }] : []
        return Response.json(docs.map(({ id, ...data }) => ({ document: { name: `projects/${project}/databases/(default)/documents/${collection}/${id}`, fields: restFields(data) } })))
      }
      if (url.endsWith('/activity/student') && checkedInRoute) return Response.json({ fields: restFields({ kind: 'queue', route: checkedInRoute }) })
      return new Response(null, { status: 404 })
    }
    assert.ok(url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/'))
    assert.equal(options.headers['x-goog-api-key'], 'fake-server-only-gemini-secret')
    const body = JSON.parse(options.body)
    assert.equal(body.generationConfig.responseMimeType, 'application/json')
    assert.doesNotMatch(body.contents[0].parts[0].text, /fake-server-only-gemini-secret|private-nickname|latitude/)
    providerCalls++
    if (failProvider) return new Response(null, { status: 503 })
    const extraction = body.generationConfig.responseSchema.properties.changes
    const briefing = body.generationConfig.responseSchema.properties.guidance
    const value = briefing ? { guidance: 'The live queues are quiet; check the route summaries before planning.' } : extraction ? { title: 'Traffic delay', summary: 'The selected departure is delayed.', reason: 'Traffic', serviceDate: date,
      changes: [{ route: 'apu', type: 'delay', departures: ['14:30'], start: null, end: null, delayMinutes: 40, revisedTime: null, capacity: null, pickup: '' }],
      unresolved: [], evidence: ['The 2:30 departure is 40 minutes late.'] }
      : { outlook: 'compare_both', explanation: 'Review the shuttle and available group before deciding.', evidenceIds: invalid ? ['invented'] : ['room:room'], cautionCodes: [invalidCaution ? 'unknown_delay' : 'estimate_only'] }
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: invalid && extraction ? '{bad json' : JSON.stringify(value) }] } }] })
  })
  const env = { FIREBASE_PROJECT_ID: project, FIREBASE_PROJECT_NUMBER: projectNumber, FIREBASE_APP_ID: appId,
    APP_ORIGIN: origin, GEMINI_API_KEY: 'fake-server-only-gemini-secret', GEMINI_MODEL: 'gemini-2.5-flash',
    UID_RATE_LIMIT: { limit: async ({ key }) => ({ success: !key.includes('limited') }) } }
  const student = await userToken('student'), admin = await userToken('admin', 'google.com'), outsider = await userToken('outsider', 'google.com')
  const send = (path, token, input = {}, appCheck = appToken, extra = {}) => worker.fetch(new Request(`https://worker.example${path}`, {
    method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'X-Firebase-AppCheck': appCheck, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(path === '/ai/notice-extract' && !Object.hasOwn(input, 'direction') ? { ...input, direction: 'apu' } : input),
  }), env)
  assert.equal((await send('/ai/status', student)).status, 403)
  assert.equal((await send('/ai/notice-extract', student, { text: 'late' })).status, 403)
  assert.equal((await send('/ai/notice-extract', outsider, { text: 'late' })).status, 403)
  assert.equal((await send('/ai/notice-extract', admin, { text: 'late' }, '')).status, 401)
  assert.equal((await send('/ai/journey-advice', student, { route: 'apu', fingerprint: '' }, 'forged')).status, 401)
  const wrongApp = await signed({ sub: 'wrong-app', aud: [`projects/${projectNumber}`], iss: `https://firebaseappcheck.googleapis.com/${projectNumber}`, iat: now, exp: now + 3600 })
  assert.equal((await send('/ai/status', admin, {}, wrongApp)).status, 401)
  assert.equal((await send('/ai/journey-advice', await userToken('limited'))).status, 429)
  assert.equal((await send('/ai/status', admin, {}, appToken, { Origin: 'https://evil.example' })).status, 403)
  const status = await send('/ai/status', admin)
  assert.equal(status.status, 200)
  assert.doesNotMatch(await status.text(), /fake-server-only/)
  assert.equal((await send('/ai/notice-extract', admin, { text: 'late', image: { mimeType: 'image/png', data: btoa('not actually an image') } })).status, 400)
  assert.equal((await send('/ai/notice-extract', admin, { text: 'x'.repeat(2_900_000) })).status, 400)
  assert.equal((await send('/ai/notice-extract', admin, { direction: 'invalid', text: 'late' })).status, 400)
  assert.equal(providerCalls, 0)
  const metrics = { current: 0, previous: 0, peakHour: -1, peakCount: 0 }
  assert.equal((await send('/ai/briefing', student, { kind: 'briefing', metrics: { apu: metrics, lrt: metrics } })).status, 403)
  assert.equal((await send('/ai/briefing', admin, { kind: 'briefing', metrics: { apu: metrics, lrt: metrics } }, '')).status, 401)
  const briefing = await send('/ai/briefing', admin, { kind: 'briefing', metrics: { apu: metrics, lrt: metrics } })
  assert.equal(briefing.status, 200)
  assert.ok((await briefing.json()).guidance)
  const extracted = await send('/ai/notice-extract', admin, { text: `On ${date}, the APU → LRT 2:30 departure is 40 minutes late. Traffic.` })
  assert.equal(extracted.status, 200)
  assert.equal((await extracted.json()).draft.changes[0].delayMinutes, 40)
  const wrongScope = await send('/ai/notice-extract', admin, { direction: 'lrt', text: `On ${date}, the APU to LRT bus is 40 minutes late. Traffic.` })
  const scoped = await wrongScope.json()
  assert.equal(scoped.draft.changes.length, 0)
  assert.ok(scoped.unresolved.length > 0)
  const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pQAAAABJRU5ErkJggg==' }
  assert.equal((await send('/ai/notice-extract', admin, { text: '', image })).status, 200)
  invalid = true
  assert.equal((await send('/ai/notice-extract', admin, { text: 'late' })).status, 502)
  invalid = false
  const rooms = [{ id: 'room', route: 'apu', fare: 1800, count: 2, status: 'open' }]
  const comparison = compareJourney({ route: 'apu', now: Date.now(), uid: 'student', queue: [], rooms, notices: [] })
  assert.equal((await send('/ai/journey-advice', student, { route: 'apu', fingerprint: 'client-invented-fares' })).status, 409)
  let response = await send('/ai/journey-advice', student, { route: 'apu', fingerprint: comparison.fingerprint })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.fingerprint, comparison.fingerprint)
  const count = providerCalls
  assert.equal((await send('/ai/journey-advice', student, { route: 'apu', fingerprint: comparison.fingerprint })).status, 200)
  assert.equal(providerCalls, count)
  invalid = true
  assert.equal((await send('/ai/journey-advice', await userToken('different-student'), { route: 'apu', fingerprint: comparison.fingerprint })).status, 502)
  invalid = false; invalidCaution = true
  assert.equal((await send('/ai/journey-advice', await userToken('caution-student'), { route: 'apu', fingerprint: comparison.fingerprint })).status, 502)
  invalidCaution = false; failProvider = true
  assert.equal((await send('/ai/notice-extract', admin, { text: 'late' })).status, 502)
  failProvider = false; denyRooms = true
  assert.equal((await send('/ai/journey-advice', student, { route: 'apu', fingerprint: comparison.fingerprint })).status, 502)
  assert.ok(!requests.includes('transportNotices'))
  failProvider = false; denyRooms = false
  checkedInRoute = 'lrt'
  await canonicalComparison(env, student, 'student', 'apu', Date.now())
  assert.ok(!requests.includes('transportNotices'))
  checkedInRoute = 'apu'
  await canonicalComparison(env, student, 'student', 'apu', Date.now())
  assert.ok(requests.includes('transportNotices') && requests.includes('activity') && requests.includes('rideListings'))
})
