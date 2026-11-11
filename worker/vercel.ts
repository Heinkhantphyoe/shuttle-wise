import { handleTravel, type TravelEnv } from './travel.ts'

type HostedEnv = Omit<TravelEnv, 'UID_RATE_LIMIT'>

// Firestore preconditions keep the limit shared across concurrent Vercel
// instances. The caller's token is used; no Firebase admin secret is needed.
export async function consumeAIRate(project: string, uid: string, token: string, appCheck: string) {
  const name = `projects/${encodeURIComponent(project)}/databases/(default)/documents/aiRateLimits/${encodeURIComponent(uid)}`
  const base = 'https://firestore.googleapis.com/v1/'
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Firebase-AppCheck': appCheck }
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(base + name, { headers, signal: AbortSignal.timeout(4_000) })
    if (!response.ok && response.status !== 404) throw new Error('AI rate verification is unavailable.')
    const previous = response.ok ? await response.json() as {
      updateTime: string; fields: { count: { integerValue: string }; startedAt: { timestampValue: string } }
    } : undefined
    const start = previous ? Date.parse(previous.fields.startedAt.timestampValue) : 0
    const count = previous ? Number(previous.fields.count.integerValue) : 0
    if (previous && (!Number.isFinite(start) || !Number.isSafeInteger(count) || count < 1 || count > 6)) throw new Error('Invalid AI rate record.')
    const reset = !previous || Date.now() >= start + 60_000
    if (!reset && count >= 6) return { success: false }
    const write = {
      update: { name, fields: { count: { integerValue: String(reset ? 1 : count + 1) },
        ...(!reset && previous ? { startedAt: previous.fields.startedAt } : {}) } },
      currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false },
      ...(reset ? { updateTransforms: [{ fieldPath: 'startedAt', setToServerValue: 'REQUEST_TIME' }] } : {}),
    }
    const committed = await fetch(`${base}projects/${encodeURIComponent(project)}/databases/(default)/documents:commit`, {
      method: 'POST', headers, body: JSON.stringify({ writes: [write] }), signal: AbortSignal.timeout(4_000),
    })
    if (committed.ok) return { success: true }
    if (![400, 409].includes(committed.status)) throw new Error('AI rate verification is unavailable.')
  }
  return { success: false }
}

export async function handleVercelAI(request: Request, env: HostedEnv) {
  const url = new URL(request.url)
  const endpoint = url.searchParams.get('endpoint') ?? url.pathname.split('/').at(-1) ?? ''
  if (!/^(notice-extract|journey-advice|briefing|status)$/.test(endpoint)) return Response.json({ error: 'Unknown AI endpoint.' }, { status: 404 })
  url.pathname = `/ai/${endpoint}`
  url.search = ''
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  try {
    return await handleTravel(new Request(url, request), { ...env, UID_RATE_LIMIT: {
      limit: ({ key }) => consumeAIRate(env.FIREBASE_PROJECT_ID, key.replace(/^travel:/, ''), token, request.headers.get('X-Firebase-AppCheck') ?? ''),
    } })
  } catch {
    return Response.json({ error: 'AI is temporarily unavailable. Your message is kept; please try again.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
