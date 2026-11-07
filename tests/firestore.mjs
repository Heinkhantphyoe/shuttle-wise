import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, FieldPath, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore'
import { updateActivity } from '../src/live.ts'
import { publishNotice, saveSettings, withdrawNotice } from '../src/notices.ts'
import { serviceDate, timeOn } from '../src/schedule.ts'

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

test('only allowlisted Google admins publish notices/settings; students see published records without private audit data', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'admins', 'admin'), {}))
  const admin = env.authenticatedContext('admin', google).firestore()
  const reader = student('student')
  const outsider = env.authenticatedContext('outsider', google).firestore()
  const date = serviceDate(Date.now() + 86400000)
  const change = { route: 'apu', type: 'delay', departures: ['14:30'], start: null, end: null, delayMinutes: 40,
    revisedTime: null, capacity: null, pickup: '' }
  const draft = { title: 'Demo traffic delay', summary: 'The selected departure is delayed.', reason: 'Traffic',
    sourceLabel: 'Emulator fixture', sourceExcerpt: 'The 2:30 departure is 40 minutes late.', sourceUrl: '',
    serviceDate: date, visibleFrom: Date.now(), expiresAt: timeOn(date, '23:59'), demo: true, changes: [change] }
  const settings = { capacity: 24, normalFare: [1500, 2000], rushFare: [2000, 2500], rushWindows: [], sourceLabel: 'Demo fixture', demo: true, version: 1, updatedAt: 0 }
  await assertSucceeds(checkIn(reader, 'student'))
  const queueBefore = (await getDoc(doc(reader, 'activity', 'student'))).data()
  await assert.rejects(publishNotice(reader, 'student', draft))
  await assert.rejects(publishNotice(outsider, 'outsider', draft))
  await assert.rejects(publishNotice(student('admin'), 'admin', draft))
  const id = await assertSucceeds(publishNotice(admin, 'admin', draft))
  const publishedQuery = () => getDocs(query(collection(reader, 'transportNotices'), where('status', '==', 'published'), where('demo', '==', true)))
  assert.equal((await assertSucceeds(publishedQuery())).size, 1)
  await assertFails(getDocs(collection(reader, 'transportNotices')))
  await assertFails(getDoc(doc(reader, 'transportNoticeAudit', id)))
  await assertFails(getDoc(doc(reader, 'travelControl', 'notices')))
  await assertSucceeds(getDoc(doc(admin, 'transportNoticeAudit', id)))
  await assert.rejects(saveSettings(reader, 'apu', settings, 'student'))
  await assert.rejects(saveSettings(outsider, 'apu', settings, 'outsider'))
  await assertSucceeds(saveSettings(admin, 'apu', settings, 'admin'))
  assert.equal((await assertSucceeds(getDoc(doc(reader, 'travelSettings', 'apu')))).data().capacity, 24)
  await assertFails(getDoc(doc(reader, 'travelSettingsAudit', 'apu')))
  await assertFails(setDoc(doc(admin, 'travelSettings', 'apu'), { ...settings, capacity: 0, version: 2, updatedAt: serverTimestamp() }))
  await assert.rejects(saveSettings(admin, 'apu', settings, 'admin'), /Settings changed/)
  const current = { ...draft, id, status: 'published', version: 1, updatedAt: Date.now() }
  const otherId = await assertSucceeds(publishNotice(admin, 'admin', { ...draft, title: 'Other direction', changes: [{ ...change, route: 'lrt', departures: ['14:25'] }] }))
  await assert.rejects(publishNotice(admin, 'admin', { ...draft, title: 'Conflicting delay' }), /Conflicting announcements/)
  const correction = { ...draft, title: 'Corrected delay', changes: [{ ...change, delayMinutes: 20 }] }
  await assertSucceeds(publishNotice(admin, 'admin', correction, current))
  await assert.rejects(publishNotice(admin, 'admin', draft, current), /changed/)
  await assertSucceeds(withdrawNotice(admin, 'admin', { ...current, ...correction, version: 2 }))
  await assertFails(getDoc(doc(reader, 'transportNotices', id)))
  const stillPublished = await assertSucceeds(publishedQuery())
  assert.equal(stillPublished.size, 1)
  assert.equal(stillPublished.docs[0].id, otherId)
  assert.deepEqual((await getDoc(doc(reader, 'activity', 'student'))).data(), queueBefore)
})

test('conflict replacement is explicit, versioned and atomic', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'admins', 'admin'), {}))
  const admin = env.authenticatedContext('admin', google).firestore()
  const date = serviceDate(Date.now() + 86400000)
  const draft = { title: 'First update', summary: 'A delay is reported.', reason: '', sourceLabel: 'Test fixture', sourceExcerpt: '', sourceUrl: '',
    serviceDate: date, visibleFrom: Date.now(), expiresAt: timeOn(date, '23:59'), demo: true,
    changes: [{ route: 'apu', type: 'delay', departures: ['14:30'], start: null, end: null, delayMinutes: 40, revisedTime: null, capacity: null, pickup: '' }] }
  const first = await publishNotice(admin, 'admin', draft)
  const second = await publishNotice(admin, 'admin', { ...draft, title: 'Replacement update' }, undefined, [first])
  assert.equal((await getDoc(doc(admin, 'transportNotices', first))).data().status, 'superseded')
  assert.equal((await getDoc(doc(admin, 'transportNotices', first))).data().version, 2)
  assert.equal((await getDoc(doc(admin, 'transportNotices', second))).data().status, 'published')
})

test('simultaneous conflicting publications cannot both become current', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'admins', 'admin'), {}))
  const admin = env.authenticatedContext('admin', google).firestore()
  const date = '2026-11-09'
  const draft = { title: 'Concurrent update', summary: 'A delay is reported.', reason: '', sourceLabel: 'Test fixture', sourceExcerpt: '', sourceUrl: '',
    serviceDate: date, visibleFrom: timeOn(date, '00:00'), expiresAt: timeOn(date, '23:59'), demo: true,
    changes: [{ route: 'apu', type: 'delay', departures: ['14:30'], start: null, end: null, delayMinutes: 40, revisedTime: null, capacity: null, pickup: '' }] }
  const results = await Promise.allSettled([publishNotice(admin, 'admin', draft), publishNotice(admin, 'admin', { ...draft, title: 'Other concurrent update' })])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await getDocs(query(collection(admin, 'transportNotices'), where('status', '==', 'published')))).size, 1)
})

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

for (const route of ['apu', 'lrt']) test(`${route}: host, join, fare and cancel preserve queue entries and private rosters`, async () => {
  const hostUid = `${route}-host`, memberUid = `${route}-member`
  const host = student(hostUid), member = student(memberUid), outsider = student(`${route}-outsider`)
  await assert.rejects(updateActivity(host, hostUid, { type: 'host', route, fare: 1800, name: 'Host' }), /Check in/)
  await checkIn(host, hostUid, route)
  await checkIn(member, memberUid, route)
  const beforeHost = (await getDoc(doc(host, 'activity', hostUid))).data()
  const beforeMember = (await getDoc(doc(member, 'activity', memberUid))).data()
  await assert.rejects(updateActivity(host, hostUid, { type: 'host', route, fare: 0, name: 'Host' }))
  assert.equal((await getDoc(doc(host, 'rideMemberships', hostUid))).exists(), false)
  await updateActivity(host, hostUid, { type: 'host', route, fare: 1800, name: 'Host' })
  const { rideId } = (await getDoc(doc(host, 'rideMemberships', hostUid))).data()
  await assert.rejects(updateActivity(outsider, `${route}-outsider`, { type: 'join', route, rideId, name: 'Outsider' }), /Check in/)
  await assertFails(getDoc(doc(outsider, 'rides', rideId)))
  await updateActivity(member, memberUid, { type: 'join', route, rideId, name: 'Member' })
  await assert.rejects(updateActivity(member, memberUid, { type: 'fare', fare: 100 }), /Only the host/)
  await assert.rejects(updateActivity(member, memberUid, { type: 'close', status: 'cancelled' }), /Only the host/)
  await updateActivity(host, hostUid, { type: 'fare', fare: 2400 })
  assert.equal((await getDoc(doc(member, 'rides', rideId))).data().fare, 2400)
  assert.equal((await getDoc(doc(outsider, 'rideListings', rideId))).data().fare, 2400)
  await updateActivity(host, hostUid, { type: 'close', status: 'cancelled' })
  assert.equal((await getDoc(doc(member, 'rides', rideId))).data().status, 'cancelled')
  assert.equal((await getDoc(doc(host, 'rideMemberships', hostUid))).exists(), false)
  assert.equal((await getDocs(query(collection(outsider, 'rideListings'), where('status', '==', 'open')))).size, 0)
  await updateActivity(member, memberUid, { type: 'leave-ride' })
  assert.equal((await getDoc(doc(member, 'rideMemberships', memberUid))).exists(), false)
  // Closed ride records remain readable to their original participants, never outsiders.
  assert.equal((await getDoc(doc(member, 'rides', rideId))).data().status, 'cancelled')
  await assertFails(getDoc(doc(outsider, 'rides', rideId)))
  assert.deepEqual((await getDoc(doc(host, 'activity', hostUid))).data(), beforeHost)
  assert.deepEqual((await getDoc(doc(member, 'activity', memberUid))).data(), beforeMember)
})

test('joining from the opposite pickup fails without changing either queue or room', async () => {
  const host = student('route-host'), member = student('wrong-route')
  await checkIn(host, 'route-host', 'apu')
  await checkIn(member, 'wrong-route', 'lrt')
  await updateActivity(host, 'route-host', { type: 'host', route: 'apu', fare: 1800, name: 'Host' })
  const { rideId } = (await getDoc(doc(host, 'rideMemberships', 'route-host'))).data()
  const before = (await getDoc(doc(member, 'activity', 'wrong-route'))).data()
  await assert.rejects(updateActivity(member, 'wrong-route', { type: 'join', route: 'apu', rideId, name: 'Member' }), /Check in/)
  await assert.rejects(updateActivity(member, 'wrong-route', { type: 'join', route: 'lrt', rideId, name: 'Member' }), /full or closed/)
  assert.equal((await getDoc(doc(member, 'rideMemberships', 'wrong-route'))).exists(), false)
  assert.equal((await getDoc(doc(host, 'rideListings', rideId))).data().count, 1)
  assert.deepEqual((await getDoc(doc(member, 'activity', 'wrong-route'))).data(), before)
})

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
