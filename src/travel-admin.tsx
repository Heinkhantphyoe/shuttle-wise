import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { useEmulators } from './firebase'
import { conflictingNoticeIds } from './journey'
import { publishNotice, watchNotices, withdrawNotice } from './notices'
import { routeIds, routeLabel } from './schedule'
import { extractNotice, prepareNoticeImage, travelAIConfigured, travelAIStatus, type NoticeImage } from './travel-ai'
import { directionRoutes, noticeErrors, type AffectedDirection, type Extraction, type NoticeChange, type TransportNotice } from './travel-contract'

const localTime = (time: number) => new Date(time + 8 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
function describeChange(change: NoticeChange) {
  const services = change.departures.length ? `Scheduled departures: ${change.departures.join(', ')}.`
    : change.start && change.end ? `Services from ${change.start} to ${change.end}.` : 'General announcement.'
  const effect = change.type === 'delay' ? change.delayMinutes !== null ? `${change.delayMinutes} minutes late.`
    : change.revisedTime ? `Revised time: ${change.revisedTime}.` : 'Delay reported; duration unconfirmed.'
    : change.type === 'cancel' ? 'These departures are cancelled.'
    : change.type === 'suspend' ? 'Service is suspended during this period.'
    : change.type === 'replacement' ? `Replaced by the ${change.revisedTime} service.`
    : change.type === 'capacity' ? `Confirmed available seats: ${change.capacity}.`
    : change.type === 'pickup' ? `Pickup change: ${change.pickup}` : 'Information only; no timetable change.'
  return `${routeLabel(change.route)}. ${services} ${effect}`
}

export function TravelAdmin({ db, user }: { db: Firestore; user: User }) {
  const [notices, setNotices] = useState<TransportNotice[]>()
  const [loadError, setLoadError] = useState('')
  const [direction, setDirection] = useState<AffectedDirection | ''>('')
  const [sourceText, setSourceText] = useState('')
  const [image, setImage] = useState<NoticeImage>()
  const [analysis, setAnalysis] = useState<Extraction>()
  const [editing, setEditing] = useState<TransportNotice>()
  const [supersede, setSupersede] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const imageVersion = useRef(0)
  useEffect(() => watchNotices(db, useEmulators, value => { setNotices(value); setLoadError('') }, error => {
    setNotices(undefined); setLoadError(error.message)
  }, true), [db])

  function clearAnalysis() { setAnalysis(undefined); setSupersede([]); setMessage('') }
  function reset() {
    imageVersion.current++
    setDirection(''); setSourceText(''); setImage(undefined); setEditing(undefined); clearAnalysis()
    if (fileInput.current) fileInput.current.value = ''
  }
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : 'Please try again.') }
    finally { setBusy(false) }
  }
  const draft = analysis?.draft
  const issues = analysis ? [...new Set([...analysis.unresolved, ...noticeErrors(analysis.draft),
    ...(!analysis.draft.reason.trim() ? ['Add the reason for this update to the message above.'] : [])])] : []
  const proposed = draft && { ...draft, id: editing?.id ?? 'new', version: (editing?.version ?? 0) + 1, updatedAt: Date.now(), status: 'published' as const }
  const conflicts = proposed && notices ? conflictingNoticeIds(proposed, notices) : []
  const published = notices?.filter(notice => notice.status === 'published') ?? []

  return <section className="travel-admin" aria-labelledby="travel-admin-heading">
    <h2 id="travel-admin-heading">Transport announcements</h2>
    <p>Choose who is affected and write the update. AI will read the details and prepare the notice for those students.</p>
    {useEmulators && <p className="notice">Local demo only. These notices stay in the emulator and are labelled as demo data.</p>}
    {loadError && <p role="alert" className="notice">Announcements unavailable: {loadError}</p>}
    <details className="card">
      <summary>AI setup</summary>
      <p>{travelAIConfigured ? 'Browser AI configuration is present. Check the Worker below.' : 'AI is not configured in this browser yet. Follow AI_SETUP.md to add the Worker URL and App Check site key.'}</p>
      <button type="button" className="secondary" disabled={busy} onClick={() => void run(async () => {
        const result = await travelAIStatus(user)
        setStatus(result.geminiConfigured ? `Gemini configured (${result.model}). App Check verified.` : 'Worker reached. Add GEMINI_API_KEY and GEMINI_MODEL. No secret is shown here.')
      })}>Check AI setup</button>
      {status && <p role="status">{status}</p>}
    </details>
    <div className="announcement-workspace">
    <div className="announcement-compose">
    <form ref={formRef} className="card announcement-form" onSubmit={event => {
      event.preventDefault()
      void run(async () => {
        if (!draft || !direction || issues.length) throw new Error('Add the missing details to the message and read it with AI again.')
        const selected = directionRoutes(direction)
        if (draft.changes.length !== selected.length || draft.changes.some(change => !selected.includes(change.route))) throw new Error('Read the update again for the selected direction.')
        if (draft.expiresAt <= Date.now()) throw new Error('This update has expired. Correct the date in your message and read it again.')
        await publishNotice(db, user.uid, draft, editing, supersede)
        reset(); setMessage('Published. Students on the affected directions will receive the update.')
      })
    }}>
      <h3>{editing ? 'Edit announcement' : 'Admin update'}</h3>
      <fieldset disabled={busy}>
        <label>Affected direction<select required value={direction} onChange={event => {
          setDirection(event.target.value as AffectedDirection | ''); clearAnalysis()
        }}><option value="">Choose a direction</option>{routeIds.map(route => <option key={route} value={route}>{routeLabel(route)}</option>)}<option value="both">Both directions</option></select></label>
        <label>Update message<textarea aria-describedby="update-message-help" value={sourceText} maxLength={8000} rows={6} onChange={event => {
          setSourceText(event.target.value); clearAnalysis()
        }} placeholder="Today, the 5:10 pm departure will be 40 minutes late because of heavy traffic." /></label>
        <p id="update-message-help" className="form-help">Include the date (or say today), affected departure or time period, what changes, and the reason. For both directions, explain the affected services in each direction.</p>
        <label>Or choose a notice image<input ref={fileInput} type="file" accept="image/png,image/jpeg" onChange={event => {
          const version = ++imageVersion.current
          const file = event.target.files?.[0]
          setImage(undefined); clearAnalysis()
          if (file) void run(async () => {
            const prepared = await prepareNoticeImage(file)
            if (version === imageVersion.current) setImage(prepared)
          })
        }} /></label>
        <p className="form-help">JPG or PNG, up to 12 MiB. The image is read by AI and is not published.</p>
        {image && <><img className="notice-preview" src={`data:${image.mimeType};base64,${image.data}`} alt="Source transport notice" />
          <button type="button" className="secondary" onClick={() => {
            imageVersion.current++; setImage(undefined); clearAnalysis(); if (fileInput.current) fileInput.current.value = ''
          }}>Remove image</button></>}
        <div className="actions"><button type="button" disabled={!direction || !sourceText.trim() && !image} onClick={() => void run(async () => {
          if (!direction) return
          setAnalysis(undefined); setSupersede([])
          const result = await extractNotice(sourceText, image, direction, user)
          setAnalysis({ ...result, draft: { ...result.draft, demo: useEmulators } })
        })}>{busy ? 'Working…' : 'Read with AI'}</button>
          <button type="button" className="secondary" onClick={reset}>{editing ? 'Cancel editing' : 'Clear'}</button></div>
        {analysis && <div className="announcement-result" aria-live="polite">
          {issues.length ? <div className="notice"><p>Add these details to your message, then read it again:</p><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>
            : <><h3>What students will see</h3><p><strong>{draft!.title}</strong></p><p>{draft!.summary}</p>
              <p>Service date: {draft!.serviceDate} · Malaysia time</p>
              {draft!.changes.map(change => <p key={change.route}>{describeChange(change)}</p>)}
              <p>Reason: {draft!.reason}</p><p className="travel-footnote">This temporary update expires {localTime(draft!.expiresAt)}. The standard timetable stays unchanged.</p>
              <p>To correct anything, change the message above and read it again.</p>
              {conflicts.length > 0 && <div className="notice"><p>This replaces an existing update only if you select it below.</p>{conflicts.map(id => <label className="check-label" key={id}>
                <input type="checkbox" checked={supersede.includes(id)} onChange={event => setSupersede(value => event.target.checked ? [...value, id] : value.filter(item => item !== id))} />Replace “{notices?.find(item => item.id === id)?.title}”
              </label>)}</div>}
              <button disabled={!notices || conflicts.some(id => !supersede.includes(id))}>{editing ? 'Publish correction' : 'Publish announcement'}</button>
            </>}
        </div>}
      </fieldset>
    </form>
    {message && <p role="status" className="notice">{message}</p>}
    </div>
    <section className="card published-announcements"><h3>Published announcements</h3>
      {!notices ? <p>Loading announcements…</p> : !published.length ? <p>No published announcements.</p> : published.sort((a, b) => b.updatedAt - a.updatedAt).map(notice => <article key={notice.id} className="published-notice">
        <h3>{notice.demo ? 'Demo · ' : ''}{notice.title}</h3>
        <p>{notice.changes.map(item => routeLabel(item.route)).join(' / ')} · {notice.serviceDate} · version {notice.version}</p>
        <p>{notice.summary}</p><p>{Date.now() >= notice.expiresAt ? 'Expired' : Date.now() < notice.visibleFrom ? 'Not visible yet' : 'Published'} · expires {localTime(notice.expiresAt)}</p>
        <div className="actions"><button className="secondary" disabled={busy} onClick={() => {
          clearAnalysis(); setEditing(notice); setDirection(notice.changes.length === 2 ? 'both' : notice.changes[0].route)
          setSourceText(`Service date: ${notice.serviceDate}.\n${notice.changes.map(describeChange).join('\n')}\nReason: ${notice.reason || 'Not supplied'}.`)
          imageVersion.current++; setImage(undefined); if (fileInput.current) fileInput.current.value = ''
          formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}>Edit update</button>
          <button className="secondary" disabled={busy} onClick={() => void run(async () => {
            await withdrawNotice(db, user.uid, notice); if (editing?.id === notice.id) reset()
            setMessage('Announcement withdrawn. Its temporary changes no longer apply.')
          })}>Withdraw</button></div>
      </article>)}
    </section>
    </div>
  </section>
}

