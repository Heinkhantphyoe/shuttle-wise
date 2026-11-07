// This script can only connect to the local demo emulator. It never uses a real project.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, serverTimestamp, setDoc, Timestamp, writeBatch } from 'firebase/firestore'

const adminUid = process.argv[2]
if (adminUid && !/^[\w-]{1,128}$/.test(adminUid)) throw new Error('Pass the Firebase UID shown after local Google sign-in, without spaces.')
const env = await initializeTestEnvironment({ projectId: 'demo-shuttlewise', firestore: { host: '127.0.0.1', port: 8080 } })
try {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    const batch = writeBatch(db)
    const now = Date.now()
    for (const route of ['apu', 'lrt']) {
      batch.set(doc(db, 'travelSettings', route), { capacity: 24, normalFare: [1500, 2000], rushFare: [2000, 2500],
        rushWindows: [{ days: [1, 2, 3, 4, 5], start: '17:00', end: '19:00' }],
        sourceLabel: 'Local demo assumptions — not approved values', demo: true, version: 1, updatedAt: serverTimestamp() })
      for (let index = 0; index < 40; index++) {
        const uid = `demo-${route}-queue-${String(index).padStart(2, '0')}`
        const joinedAt = Timestamp.fromMillis(now - (40 - index) * 1000)
        batch.set(doc(db, 'activity', uid), { kind: 'queue', route, joinedAt, eventId: uid })
        batch.set(doc(db, 'history', uid), { route, joinedAt })
      }
      for (const fare of [1800, 2200, 2500]) {
        const id = `demo-${route}-room-${fare}`
        const host = `${id}-host`, peer = `${id}-peer`
        batch.set(doc(db, 'rides', id), { route, fare, host, members: { [host]: 'Demo host', [peer]: 'Demo member' }, status: 'open', listed: true })
        batch.set(doc(db, 'rideListings', id), { route, fare, count: 2, status: 'open' })
        batch.set(doc(db, 'rideMemberships', host), { route, rideId: id })
        batch.set(doc(db, 'rideMemberships', peer), { route, rideId: id })
      }
    }
    await batch.commit()
    if (adminUid) await setDoc(doc(db, 'admins', adminUid), {})
  })
  console.log('Reset local demo only: 40 check-ins per direction, sample capacity 24, and RM18/RM22/RM25 rooms. No real service data was changed.')
  if (!adminUid) console.log('Optional: after local Google sign-in, run npm run demo:reset -- YOUR_LOCAL_UID to allow that local admin.')
} finally { await env.cleanup() }
