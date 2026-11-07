import { collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, query, runTransaction, serverTimestamp, where,
  type Firestore, type DocumentData } from 'firebase/firestore'
import { conflictingNoticeIds } from './journey.ts'
import { noticeErrors, parseNotice, validSettings, type NoticeDraft, type TransportNotice, type TravelSettings } from './travel-contract.ts'
import type { RouteId } from './schedule'

function millis(value: unknown) {
  return value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function' ? Math.floor(value.toMillis() as number) : NaN
}
export function noticeRecord(id: string, data: DocumentData) {
  return parseNotice({ ...data, id, updatedAt: millis(data.updatedAt) })
}
export function settingsRecord(data: DocumentData): TravelSettings {
  const result = { ...data, updatedAt: millis(data.updatedAt) }
  if (!validSettings(result)) throw new Error('Invalid route settings. Ask an admin to review them.')
  return result
}

export function watchNotices(db: Firestore, demo: boolean, receive: (notices: TransportNotice[]) => void, error: (error: Error) => void, admin = false) {
  const source = admin ? query(collection(db, 'transportNotices'), where('demo', '==', demo))
    : query(collection(db, 'transportNotices'), where('status', '==', 'published'), where('demo', '==', demo))
  return onSnapshot(source, { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.hasPendingWrites) return
    if (snapshot.metadata.fromCache) { error(new Error('Announcements are not yet confirmed by the server.')); return }
    try { receive(snapshot.docs.map(item => noticeRecord(item.id, item.data()))) } catch (failure) { error(failure as Error) }
  }, error)
}

export function watchSettings(db: Firestore, route: RouteId, receive: (settings: TravelSettings | undefined) => void, error: (error: Error) => void) {
  return onSnapshot(doc(db, 'travelSettings', route), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.hasPendingWrites) return
    if (snapshot.metadata.fromCache) { error(new Error('Route settings are not yet confirmed by the server.')); return }
    try { receive(snapshot.exists() ? settingsRecord(snapshot.data()) : undefined) } catch (failure) { error(failure as Error) }
  }, error)
}

export async function publishNotice(db: Firestore, uid: string, draft: NoticeDraft, previous?: TransportNotice, supersedeIds: string[] = []) {
  const errors = noticeErrors(draft)
  if (errors.length) throw new Error(errors.join(' '))
  const controlRef = doc(db, 'travelControl', 'notices')
  // Serialize publication/withdrawal without broadening student access or adding a backend database proxy.
  const control = await getDocFromServer(controlRef)
  const revision = control.data()?.revision ?? 0
  const published = await getDocsFromServer(query(collection(db, 'transportNotices'), where('status', '==', 'published'), where('demo', '==', draft.demo)))
  const ref = previous ? doc(db, 'transportNotices', previous.id) : doc(collection(db, 'transportNotices'))
  const proposed: TransportNotice = { ...draft, id: ref.id, version: (previous?.version ?? 0) + 1, status: 'published', updatedAt: Date.now() }
  const current = published.docs.map(item => noticeRecord(item.id, item.data()))
  const conflicts = conflictingNoticeIds(proposed, current)
  if (conflicts.some(id => !supersedeIds.includes(id))) throw new Error('Conflicting announcements exist. Explicitly select the older notices to replace, or change the affected services.')
  if (supersedeIds.some(id => !current.some(notice => notice.id === id && notice.id !== ref.id))) throw new Error('An announcement changed. Refresh and review again.')
  await runTransaction(db, async transaction => {
    const latestControl = await transaction.get(controlRef)
    const existing = await transaction.get(ref)
    const replaced = await Promise.all(supersedeIds.map(id => transaction.get(doc(db, 'transportNotices', id))))
    if ((latestControl.data()?.revision ?? 0) !== revision || existing.exists() && (!previous || existing.data().version !== previous.version)
      || previous && !existing.exists() || replaced.some(item => !item.exists() || item.data()?.status !== 'published')) {
      throw new Error('Announcements changed while you reviewed. Refresh and try again.')
    }
    transaction.set(controlRef, { revision: revision + 1, updatedAt: serverTimestamp() })
    transaction.set(ref, { ...draft, version: proposed.version, status: 'published', updatedAt: serverTimestamp() })
    transaction.set(doc(db, 'transportNoticeAudit', ref.id), { adminUid: uid, version: proposed.version, action: 'publish', updatedAt: serverTimestamp() })
    for (const item of replaced) {
      transaction.update(item.ref, { status: 'superseded', version: item.data()!.version + 1, updatedAt: serverTimestamp() })
      transaction.set(doc(db, 'transportNoticeAudit', item.id), { adminUid: uid, version: item.data()!.version + 1, action: 'supersede', updatedAt: serverTimestamp() })
    }
  })
  return ref.id
}

export async function withdrawNotice(db: Firestore, uid: string, notice: TransportNotice) {
  const ref = doc(db, 'transportNotices', notice.id)
  const controlRef = doc(db, 'travelControl', 'notices')
  await runTransaction(db, async transaction => {
    const [current, control] = await Promise.all([transaction.get(ref), transaction.get(controlRef)])
    if (!current.exists() || current.data().version !== notice.version || current.data().status !== 'published') throw new Error('This announcement changed. Review the latest version.')
    transaction.update(ref, { status: 'withdrawn', version: notice.version + 1, updatedAt: serverTimestamp() })
    transaction.set(controlRef, { revision: (control.data()?.revision ?? 0) + 1, updatedAt: serverTimestamp() })
    transaction.set(doc(db, 'transportNoticeAudit', notice.id), { adminUid: uid, version: notice.version + 1, action: 'withdraw', updatedAt: serverTimestamp() })
  })
}

export async function saveSettings(db: Firestore, route: RouteId, settings: TravelSettings, uid: string) {
  if (!validSettings(settings)) throw new Error('Check capacity, fare ranges, source, and nonoverlapping rush-hour windows.')
  const ref = doc(db, 'travelSettings', route)
  await runTransaction(db, async transaction => {
    const current = await transaction.get(ref)
    if ((current.data()?.version ?? 0) + 1 !== settings.version) throw new Error('Settings changed. Reload and review before saving.')
    transaction.set(ref, { ...settings, updatedAt: serverTimestamp() })
    transaction.set(doc(db, 'travelSettingsAudit', route), { adminUid: uid, version: settings.version, updatedAt: serverTimestamp() })
  })
}
