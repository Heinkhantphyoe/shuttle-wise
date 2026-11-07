import {
  collection, doc, FieldPath, onSnapshot, query, runTransaction, serverTimestamp, where,
  type Firestore, type QueryDocumentSnapshot, type Timestamp,
} from 'firebase/firestore'
import type { RouteId } from './schedule'

export type CheckIn = { kind: 'queue'; route: RouteId; joinedAt: Timestamp; eventId: string }
export type RideActivity = { kind: 'ride'; route: RouteId; rideId: string }
export type Activity = CheckIn | RideActivity
export type Ride = {
  route: RouteId
  host: string
  fare: number
  members: Record<string, string>
  status: 'open' | 'departed' | 'cancelled'
  listed?: true
}
export type RideListing = Pick<Ride, 'route' | 'fare' | 'status'> & { count: number }
export type Row<T> = T & { id: string }
export type HistoryEvent = { route: RouteId; joinedAt: Timestamp }
type Command =
  | { type: 'check-in'; route: RouteId }
  | { type: 'board'; route: RouteId; eventId: string }
  | { type: 'leave' }
  | { type: 'host'; route: RouteId; fare: number; name: string }
  | { type: 'join'; route: RouteId; rideId: string; name: string }
  | { type: 'fare'; fare: number }
  | { type: 'close'; status: 'departed' | 'cancelled' }

function row<T>(snapshot: QueryDocumentSnapshot): Row<T> {
  return { ...snapshot.data() as T, id: snapshot.id }
}

export function watchQueue(db: Firestore, route: RouteId, receive: (entries: Row<CheckIn>[]) => void, error: (error: Error) => void) {
  return onSnapshot(query(collection(db, 'activity'), where('kind', '==', 'queue'), where('route', '==', route)),
    snapshot => receive(snapshot.docs.map(row<CheckIn>).sort((a, b) =>
      a.joinedAt?.seconds - b.joinedAt?.seconds || a.joinedAt?.nanoseconds - b.joinedAt?.nanoseconds
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))), error)
}

export function watchActivity(db: Firestore, uid: string, receive: (activity: Activity | undefined) => void, error: (error: Error) => void) {
  return onSnapshot(doc(db, 'activity', uid), snapshot => receive(snapshot.data() as Activity | undefined), error)
}

export function watchRide(db: Firestore, id: string, receive: (ride: Row<Ride> | undefined) => void, error: (error: Error) => void) {
  return onSnapshot(doc(db, 'rides', id), snapshot => receive(snapshot.exists() ? row<Ride>(snapshot) : undefined), error)
}

export function watchRides(db: Firestore, route: RouteId, receive: (rides: Row<RideListing>[]) => void, error: (error: Error) => void) {
  return onSnapshot(query(collection(db, 'rideListings'), where('route', '==', route), where('status', '==', 'open')),
    snapshot => receive(snapshot.docs.map(row<RideListing>)), error)
}

export function watchHistory(db: Firestore, cutoff: Date, receive: (events: HistoryEvent[]) => void, error: (error: Error) => void) {
  return onSnapshot(query(collection(db, 'history'), where('joinedAt', '>=', cutoff)),
    snapshot => receive(snapshot.docs.map(item => item.data() as HistoryEvent)), error)
}

export function updateActivity(db: Firestore, uid: string, command: Command) {
  const activityRef = doc(db, 'activity', uid)
  const eventRef = doc(collection(db, 'history'))
  const newRideRef = doc(collection(db, 'rides'))
  return runTransaction(db, async transaction => {
    const activity = (await transaction.get(activityRef)).data() as Activity | undefined
    const currentRideRef = activity?.kind === 'ride' ? doc(db, 'rides', activity.rideId) : undefined
    const currentRide = currentRideRef
      ? (await transaction.get(currentRideRef)).data() as Ride | undefined : undefined

    switch (command.type) {
      case 'check-in': {
        if (activity?.kind === 'queue') throw new Error('Leave your current queue first.')
        if (currentRide?.status === 'open') throw new Error('Leave your current ride first.')
        const joinedAt = serverTimestamp()
        transaction.set(activityRef, { kind: 'queue', route: command.route, joinedAt, eventId: eventRef.id })
        transaction.set(eventRef, { route: command.route, joinedAt })
        break
      }
      case 'host':
      case 'join': {
        if (activity?.kind !== 'queue' || activity.route !== command.route) {
          throw new Error('Check in at this pickup before hosting or joining a ride.')
        }
        if (command.type === 'host') {
          transaction.set(newRideRef, {
            route: command.route, host: uid, fare: command.fare, members: { [uid]: command.name }, status: 'open', listed: true,
          })
          transaction.set(doc(db, 'rideListings', newRideRef.id), {
            route: command.route, fare: command.fare, status: 'open', count: 1,
          })
          transaction.set(activityRef, { kind: 'ride', route: command.route, rideId: newRideRef.id })
          break
        }
        const rideRef = doc(db, 'rides', command.rideId)
        const listingRef = doc(db, 'rideListings', command.rideId)
        const listing = (await transaction.get(listingRef)).data() as RideListing | undefined
        if (!listing || listing.status !== 'open' || listing.route !== command.route || listing.count >= 4) {
          throw new Error('This ride is full or closed. Your queue spot was kept.')
        }
        transaction.update(rideRef, new FieldPath('members', uid), command.name)
        transaction.update(listingRef, { count: listing.count + 1 })
        transaction.set(activityRef, { kind: 'ride', route: command.route, rideId: rideRef.id })
        break
      }
      case 'board': {
        if (!activity) break
        if (activity.kind !== 'queue' || activity.route !== command.route || activity.eventId !== command.eventId) {
          throw new Error('Your check-in changed. Refresh your queue status and try again.')
        }
        transaction.delete(activityRef)
        break
      }
      case 'leave': {
        if (!activity) break
        if (currentRideRef && currentRide?.status === 'open') {
          if (currentRide.host === uid) throw new Error('Close or cancel your ride first.')
          const members = { ...currentRide.members }
          delete members[uid]
          transaction.update(currentRideRef, { members })
          if (currentRide.listed) transaction.update(doc(db, 'rideListings', currentRideRef.id), { count: Object.keys(members).length })
        }
        transaction.delete(activityRef)
        break
      }
      case 'fare':
      case 'close': {
        if (!currentRideRef || currentRide?.status !== 'open' || currentRide.host !== uid) {
          throw new Error('Only the host can manage an open ride.')
        }
        const changes = command.type === 'fare' ? { fare: command.fare } : { status: command.status }
        transaction.update(currentRideRef, changes)
        if (currentRide.listed) transaction.update(doc(db, 'rideListings', currentRideRef.id), changes)
        if (command.type === 'close') transaction.delete(activityRef)
        break
      }
    }
  })
}
