import assert from 'node:assert/strict'
import test from 'node:test'
import { webcrypto } from 'node:crypto'
import worker from '../worker/index.ts'

test('the Worker enforces origin, token signature, rate limit, and admin allowlist', async t => {
  const project = 'demo-shuttlewise'
  const origin = 'https://demo-shuttlewise.web.app'
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
  const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])
  const jwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey)
  const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url')
  async function token(uid, provider, expiresIn = 60) {
    const now = Math.floor(Date.now() / 1000)
    const payload = encode({
      sub: uid, aud: project, iss: `https://securetoken.google.com/${project}`,
      iat: now, auth_time: now, exp: now + expiresIn, firebase: { sign_in_provider: provider },
    })
    const message = `${encode({ alg: 'RS256', kid: 'test-key' })}.${payload}`
    const signature = await webcrypto.subtle.sign(algorithm, keys.privateKey, Buffer.from(message))
    return `${message}.${Buffer.from(signature).toString('base64url')}`
  }

  let providerCalls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.startsWith('https://www.googleapis.com/')) return Response.json({ keys: [{ ...jwk, kid: 'test-key' }] })
    if (url.startsWith('https://firestore.googleapis.com/')) {
      return new Response(null, { status: url.endsWith('/admins/admin') ? 200 : 404 })
    }
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.equal(options.headers.Authorization, 'Bearer fake-worker-secret')
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'openrouter/free')
    assert.doesNotMatch(body.messages[0].content, /fake-worker-secret|latitude/)
    providerCalls++
    return Response.json({ choices: [{ message: { content: '{"guidance":"Stay near the pickup."}' } }] })
  })

  const env = {
    FIREBASE_PROJECT_ID: project, APP_ORIGIN: origin, OPENROUTER_API_KEY: 'fake-worker-secret',
    UID_RATE_LIMIT: { limit: async ({ key }) => ({ success: key !== 'rate-limited' }) },
  }
  const route = { current: 5, previous: 10, peakHour: 7, peakCount: 3 }
  const briefing = { kind: 'briefing', metrics: { apu: route, lrt: route } }
  const send = (idToken, input, from = origin) => worker.fetch(new Request('https://worker.example', {
    method: 'POST', headers: { Origin: from, Authorization: `Bearer ${idToken}` }, body: JSON.stringify(input),
  }), env)
  const anonymous = await token('student', 'anonymous')
  assert.equal((await send(anonymous, briefing, 'https://other.example')).status, 403)
  assert.equal((await send('invalid.token.signature', briefing)).status, 401)
  const [header, payload, signature] = anonymous.split('.')
  const forgedSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)
  assert.equal((await send(`${header}.${payload}.${forgedSignature}`, briefing)).status, 401)
  assert.equal((await send(await token('student', 'anonymous', -1), briefing)).status, 401)
  assert.equal((await send(await token('rate-limited', 'anonymous'), briefing)).status, 429)
  assert.equal((await send(anonymous, { ...briefing, metrics: { ...briefing.metrics, latitude: 3 } })).status, 400)
  assert.equal((await send(anonymous, briefing)).status, 403)
  assert.equal((await send(await token('other', 'google.com'), briefing)).status, 403)
  assert.equal(providerCalls, 0)
  const response = await send(await token('admin', 'google.com'), briefing)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { guidance: 'Stay near the pickup.' })
  assert.equal(providerCalls, 1)
})
