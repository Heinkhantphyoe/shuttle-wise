import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { webcrypto } from 'node:crypto'
import { localAiMiddleware } from '../scripts/local-ai.mjs'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer as createViteServer } from 'vite'

test('local AI verifies origin, Firebase identity and admin access before reading a bounded notice', async t => {
  const project = 'local-ai-test'
  const secret = 'fake-local-server-secret'
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
  const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])
  const jwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey)
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  async function token(uid, provider = 'google.com') {
    const now = Math.floor(Date.now() / 1000)
    const message = `${encode({ alg: 'RS256', kid: 'local-ai-test' })}.${encode({ sub: uid, aud: project,
      iss: `https://securetoken.google.com/${project}`, iat: now, auth_time: now, exp: now + 3600,
      firebase: { sign_in_provider: provider } })}`
    const signature = await webcrypto.subtle.sign(algorithm, keys.privateKey, Buffer.from(message))
    return `${message}.${Buffer.from(signature).toString('base64url')}`
  }
  let providerCalls = 0, failed = false, invalid = false
  const realFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, options)
    if (String(url).startsWith('https://www.googleapis.com/')) return Response.json({ keys: [{ ...jwk, kid: 'local-ai-test' }] })
    if (String(url).includes('/admins/')) return new Response(null, { status: String(url).endsWith('/outsider') ? 404 : 200 })
    assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/'))
    assert.equal(options.headers['x-goog-api-key'], secret)
    providerCalls++
    if (failed) return new Response(null, { status: 503 })
    const value = JSON.parse(options.body).generationConfig.responseSchema.properties.guidance
      ? { guidance: 'There are no recent check-ins on either route.' }
      : { title: 'Traffic delay', summary: 'This departure is delayed.', reason: 'Traffic', serviceDate: '2026-11-11',
      changes: [{ route: 'lrt', type: 'delay', departures: ['17:10'], start: null, end: null, delayMinutes: 40,
        revisedTime: null, capacity: null, pickup: '' }], unresolved: [], evidence: ['40 minutes late because of traffic.'] }
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: invalid ? '{invalid' : JSON.stringify(value) }] } }] })
  })
  const middleware = localAiMiddleware({ FIREBASE_PROJECT_ID: project, GEMINI_API_KEY: secret, GEMINI_MODEL: 'test-model' })
  const server = createServer((req, res) => void middleware(req, res, () => { res.writeHead(404); res.end() }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const origin = `http://127.0.0.1:${server.address().port}`
  const admin = await token('admin')
  const input = { direction: 'lrt', text: 'On 11 November 2026, the 5:10 pm departure is 40 minutes late because of traffic.' }
  const send = (path, auth = admin, body = input, headers = {}) => fetch(`${origin}/__local-ai/${path}`, {
    method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  })
  assert.equal((await send('notice-extract', '', input)).status, 401)
  assert.equal((await send('notice-extract', 'forged')).status, 401)
  assert.equal((await send('notice-extract', await token('student', 'anonymous'))).status, 403)
  assert.equal((await send('notice-extract', await token('outsider'))).status, 403)
  assert.equal((await send('notice-extract', admin, input, { Origin: 'https://evil.example' })).status, 403)
  const badHost = await new Promise((resolve, reject) => {
    const req = request(`${origin}/__local-ai/status`, { method: 'POST', headers: { Host: 'evil.example', Origin: origin } }, res => {
      res.resume(); resolve(res.statusCode)
    })
    req.on('error', reject); req.end('{}')
  })
  assert.equal(badHost, 403)
  assert.equal((await send('unknown')).status, 404)
  assert.equal((await fetch(`${origin}/__local-ai/status`, { headers: { Origin: origin } })).status, 405)
  const status = await send('status')
  assert.equal(status.status, 200)
  const statusText = await status.text()
  assert.doesNotMatch(statusText, /fake-local-server-secret/)
  assert.equal(JSON.parse(statusText).appCheckVerified, false)
  assert.equal((await send('notice-extract', admin, { ...input, direction: 'unknown' })).status, 400)
  assert.equal((await send('notice-extract', admin, { ...input, image: { mimeType: 'image/png', data: 'AAAA' } })).status, 400)
  assert.equal((await send('notice-extract', admin, { ...input, text: 'x'.repeat(2_900_000) })).status, 400)
  assert.equal(providerCalls, 0)
  const extracted = await send('notice-extract')
  assert.equal(extracted.status, 200)
  const result = await extracted.json()
  assert.equal(result.draft.changes[0].route, 'lrt')
  assert.equal(result.draft.changes[0].delayMinutes, 40)
  assert.deepEqual(result.unresolved, [])
  const briefingAdmin = await token('briefing-admin')
  const metrics = { current: 0, previous: 0, peakHour: -1, peakCount: 0 }
  const briefing = await send('briefing', briefingAdmin, { kind: 'briefing', metrics: { apu: metrics, lrt: metrics } })
  assert.equal(briefing.status, 200)
  assert.equal((await briefing.json()).guidance, 'There are no recent check-ins on either route.')
  assert.equal((await send('briefing', briefingAdmin, { kind: 'briefing', names: ['private-name'] })).status, 400)
  assert.equal((await send('briefing', await token('briefing-student', 'anonymous'), { kind: 'briefing', metrics: { apu: metrics, lrt: metrics } })).status, 403)
  failed = true
  assert.equal((await send('notice-extract', await token('failure'))).status, 502)
  failed = false; invalid = true
  assert.equal((await send('notice-extract', await token('invalid'))).status, 502)
  const limited = await token('limited')
  for (let i = 0; i < 6; i++) assert.equal((await send('status', limited)).status, 200)
  assert.equal((await send('notice-extract', limited)).status, 429)
})

test('the development server blocks private backups and environment files', async () => {
  const folder = `.firebase/security-test-${crypto.randomUUID()}`
  const file = `${folder}/backup.json`
  const sentinel = 'fake-private-backup-for-security-test'
  await mkdir(folder, { recursive: true })
  await writeFile(file, sentinel)
  let server
  try {
    server = await createViteServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
    await server.listen()
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    for (const path of [`/${file}`, `/@fs${resolve(file)}`, '/.env', '/worker/.dev.vars']) {
      const response = await fetch(origin + path)
      assert.equal(response.status, 403, `${path} must not be served`)
      assert.ok(!(await response.text()).includes(sentinel))
    }
  } finally {
    await server?.close()
    await rm(folder, { recursive: true, force: true })
  }
})
