import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, FieldPath, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore'
import { updateActivity } from '../src/live.ts'

let env
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-shuttlewise',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

test('boarding removes only the matching check-in and preserves history', async () => {
  const uid = 'boarding-student'
  const db = student(uid)
  const activityRef = doc(db, 'activity', uid)
  await assertSucceeds(checkIn(db, uid))
  const { eventId } = (await getDoc(activityRef)).data()
  const board = { type: 'board', route: 'apu', eventId }
  await assert.rejects(updateActivity(db, uid, { ...board, route: 'lrt' }), /check-in changed/)
  await assertSucceeds(updateActivity(db, uid, board))
  assert.equal((await getDoc(activityRef)).exists(), false)
  await assertSucceeds(updateActivity(db, uid, board))
  await assertSucceeds(checkIn(db, uid))
  await assert.rejects(updateActivity(db, uid, board), /check-in changed/)
  assert.equal((await getDoc(activityRef)).data().kind, 'queue')
  await env.withSecurityRulesDisabled(async context => {
    assert.equal((await getDoc(doc(context.firestore(), 'history', eventId))).exists(), true)
  })
})
after(() => env?.cleanup())
beforeEach(() => env.clearFirestore())

function student(uid) {
  return env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore()
}

const google = { firebase: { sign_in_provider: 'google.com' } }

function checkIn(db, uid, route = 'apu') {
  return updateActivity(db, uid, { type: 'check-in', route })
}

function directCheckIn(db, uid, route = 'apu') {
  const event = doc(collection(db, 'history'))
  const batch = writeBatch(db)
  batch.set(doc(db, 'activity', uid), { kind: 'queue', route, joinedAt: serverTimestamp(), eventId: event.id })
  batch.set(event, { route, joinedAt: serverTimestamp() })
  return batch.commit()
}

test('check-in, queue and history access, and concurrent ride joins', async () => {
  const host = student('host')
  const second = student('second')
  const peers = ['second', 'third', 'fourth', 'fifth'].map(uid => ({ uid, db: student(uid) }))
  await assertSucceeds(checkIn(host, 'host'))
  await assertFails(directCheckIn(host, 'host', 'lrt'))
  await assertFails(directCheckIn(second, 'host'))
  await assertFails(getDocs(collection(second, 'activity')))
  const queued = await assertSucceeds(getDocs(query(collection(second, 'activity'), where('kind', '==', 'queue'), where('route', '==', 'apu'))))
  assert.equal(queued.size, 1)
  await assertFails(getDocs(collection(second, 'history')))
  await assertFails(setDoc(doc(second, 'history', 'fake'), { route: 'apu', joinedAt: serverTimestamp() }))
  await assertFails(setDoc(doc(second, 'admins', 'second'), {}))
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'admins', 'admin'), {}))
  const admin = env.authenticatedContext('admin', google).firestore()
  const other = env.authenticatedContext('other', google).firestore()
  await assertSucceeds(getDocs(collection(admin, 'history')))
  await assertFails(getDocs(collection(other, 'history')))
  await assertFails(getDocs(collection(student('admin'), 'history')))

  const ride = { host: 'host', route: 'apu', fare: 1500, status: 'open', members: { host: 'Host' }, listed: true }
  await assertFails(setDoc(doc(host, 'rides', 'shared'), ride))
  const hostQueue = doc(host, 'activity', 'host')
  const hostCheckIn = (await getDoc(hostQueue)).data()
  await assertSucceeds(updateActivity(host, 'host', { type: 'host', route: 'apu', fare: 1500, name: 'Host' }))
  assert.deepEqual((await getDoc(hostQueue)).data(), hostCheckIn)
  const { rideId } = (await getDoc(doc(host, 'rideMemberships', 'host'))).data()
  await assertFails(getDoc(doc(second, 'rideMemberships', 'host')))
  await assert.rejects(updateActivity(host, 'host', { type: 'host', route: 'apu', fare: 1500, name: 'Host' }), /current ride/)
  const listing = db => doc(db, 'rideListings', rideId)
  const roster = db => doc(db, 'rides', rideId)
  await assertFails(getDoc(roster(second)))
  await assertFails(getDocs(query(collection(second, 'rides'), where('status', '==', 'open'))))
  const listings = await assertSucceeds(getDocs(query(collection(second, 'rideListings'), where('status', '==', 'open'))))
  assert.deepEqual(listings.docs[0].data(), { route: 'apu', fare: 1500, status: 'open', count: 1 })
  await assertFails(setDoc(listing(second), { route: 'apu', fare: 1500, status: 'open', count: 2 }))
  await Promise.all(peers.map(({ uid, db }) => assertSucceeds(checkIn(db, uid))))
  const checkIns = await Promise.all(peers.map(async ({ uid, db }) => (await getDoc(doc(db, 'activity', uid))).data()))

  const join = ({ uid, db }) => updateActivity(db, uid, { type: 'join', route: 'apu', rideId, name: uid })
  const results = await Promise.allSettled(peers.map(join))
  const successes = results.filter(result => result.status === 'fulfilled').length
  assert.ok(successes >= 1 && successes <= 3)
  const waiting = peers.filter((_, index) => results[index].status === 'rejected')
  for (const peer of waiting) {
    assert.equal((await getDoc(doc(peer.db, 'activity', peer.uid))).data().kind, 'queue')
  }
  // The emulator can time out contending clients. Verify retries can fill the remaining seats.
  for (const peer of waiting.slice(0, 3 - successes)) await assertSucceeds(join(peer))
  const { uid, db } = waiting.at(-1)
  await assert.rejects(join({ uid, db }), /full or closed/)
  assert.equal((await getDoc(doc(db, 'activity', uid))).data().kind, 'queue')
  const full = (await getDoc(roster(host))).data()
  assert.equal(Object.keys(full.members).length, 4)
  for (const [index, peer] of peers.entries()) {
    assert.deepEqual((await getDoc(doc(peer.db, 'activity', peer.uid))).data(), checkIns[index])
  }
  const bypass = writeBatch(db)
  bypass.update(roster(db), new FieldPath('members', uid), uid)
  bypass.update(listing(db), { count: 5 })
  bypass.set(doc(db, 'rideMemberships', uid), { route: 'apu', rideId })
  await assertFails(bypass.commit())
  assert.equal((await getDoc(doc(db, 'activity', uid))).data().kind, 'queue')

  const member = peers.find(peer => peer.uid in full.members)
  await assertSucceeds(getDoc(roster(member.db)))
  await assertSucceeds(updateActivity(member.db, member.uid, { type: 'leave-ride' }))
  await assertFails(getDoc(roster(member.db)))
  assert.deepEqual((await getDoc(doc(member.db, 'activity', member.uid))).data(), checkIns[peers.indexOf(member)])
  await assertSucceeds(updateActivity(host, 'host', { type: 'fare', fare: 1600 }))
  assert.deepEqual((await getDoc(listing(db))).data(), { route: 'apu', fare: 1600, status: 'open', count: 3 })
  const formerMember = peers.find(peer => peer.uid !== member.uid && peer.uid in full.members)
  await assertSucceeds(updateActivity(formerMember.db, formerMember.uid, { type: 'leave-queue' }))
  assert.equal((await getDoc(doc(formerMember.db, 'activity', formerMember.uid))).exists(), false)
  await assertSucceeds(getDoc(roster(formerMember.db)))
  await assertSucceeds(updateActivity(host, 'host', { type: 'close', status: 'departed' }))
  assert.deepEqual((await getDoc(hostQueue)).data(), hostCheckIn)
  await assertFails(getDoc(listing(db)))
  await assertFails(getDoc(roster(db)))
  assert.equal((await assertSucceeds(getDoc(roster(formerMember.db)))).data().status, 'departed')
  await assertSucceeds(checkIn(formerMember.db, formerMember.uid, 'lrt'))
})
