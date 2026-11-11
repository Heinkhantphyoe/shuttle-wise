import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeAIRate, handleVercelAI } from '../worker/vercel.ts'

const record = (count = 2, age = 1000) => ({ updateTime: 'version-one', fields: {
  count: { integerValue: String(count) }, startedAt: { timestampValue: new Date(Date.now() - age).toISOString() },
} })

test('Vercel rejects unknown routes, wrong origins and missing identity before database or AI access', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No external requests expected') })
  const env = { APP_ORIGIN: 'https://example.vercel.app', FIREBASE_PROJECT_ID: 'demo-shuttlewise' }
  const send = (path, origin = env.APP_ORIGIN) => handleVercelAI(new Request(`https://example.vercel.app${path}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
  }), env)
  assert.equal((await send('/api/ai?endpoint=unknown')).status, 404)
  assert.equal((await send('/api/ai?endpoint=status', 'https://wrong.example')).status, 403)
  assert.equal((await send('/api/ai?endpoint=status')).status, 401)
  assert.equal((await send('/ai/notice-extract')).status, 401)
  assert.equal((await send('/ai/briefing')).status, 401)
})

test('Vercel AI quota uses atomic Firestore writes and keeps tokens out of the stored counter', async t => {
  let committed
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer caller-token')
    assert.equal(options.headers['X-Firebase-AppCheck'], 'verified-app')
    if (!url.endsWith(':commit')) return Response.json(record())
    committed = JSON.parse(options.body).writes[0]
    return Response.json({ writeResults: [{}] })
  })
  assert.deepEqual(await consumeAIRate('project', 'student', 'caller-token', 'verified-app'), { success: true })
  assert.deepEqual(committed.currentDocument, { updateTime: 'version-one' })
  assert.equal(committed.update.fields.count.integerValue, '3')
  assert.deepEqual(Object.keys(committed.update.fields).sort(), ['count', 'startedAt'])
  assert.doesNotMatch(JSON.stringify(committed), /caller-token|verified-app/)
})

test('quota denies a seventh request and resets expired windows using server time', async t => {
  let previous = record(6), writes = 0, last
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (!url.endsWith(':commit')) return Response.json(previous)
    writes++
    last = JSON.parse(options.body).writes[0]
    return Response.json({ writeResults: [{}] })
  })
  assert.equal((await consumeAIRate('project', 'student', 'token', 'app')).success, false)
  assert.equal(writes, 0)
  previous = record(6, 61_000)
  assert.equal((await consumeAIRate('project', 'student', 'token', 'app')).success, true)
  assert.equal(last.update.fields.count.integerValue, '1')
  assert.deepEqual(last.updateTransforms, [{ fieldPath: 'startedAt', setToServerValue: 'REQUEST_TIME' }])
})

test('quota retries conflicting writes and fails closed when storage permissions fail', async t => {
  let conflicts = 2, writes = 0, denied = false
  t.mock.method(globalThis, 'fetch', async url => {
    if (denied) return new Response(null, { status: 403 })
    if (!url.endsWith(':commit')) return new Response(null, { status: 404 })
    writes++
    return writes <= conflicts ? new Response(null, { status: 409 }) : Response.json({ writeResults: [{}] })
  })
  assert.equal((await consumeAIRate('project', 'student', 'token', 'app')).success, true)
  assert.equal(writes, 3)
  writes = 0; conflicts = 10
  assert.equal((await consumeAIRate('project', 'student', 'token', 'app')).success, false)
  assert.equal(writes, 4)
  denied = true
  await assert.rejects(consumeAIRate('project', 'student', 'token', 'app'), /unavailable/)
})
