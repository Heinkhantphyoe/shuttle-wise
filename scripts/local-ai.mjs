import { Readable } from 'node:stream'
import { claimsFor, allowlisted, readInput } from '../worker/auth.ts'
import { readAdminBriefing, readTransportUpdate, validateImage } from '../worker/travel.ts'
import { isDirection, object } from '../src/travel-contract.ts'
import { validAIRequest } from '../src/ai-contract.ts'

const loopback = host => ['localhost', '127.0.0.1', '[::1]', '::1', '::ffff:127.0.0.1'].includes(host)

// Development only. The hosted Worker still requires Firebase App Check.
export function localAiMiddleware(env) {
  const limits = new Map()
  return async (incoming, outgoing, next) => {
    if (!incoming.url?.startsWith('/__local-ai/')) return next()
    const reply = (status, body) => {
      outgoing.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      outgoing.end(JSON.stringify(body))
    }
    let url
    try { url = new URL(incoming.url, `http://${incoming.headers.host}`) } catch { return reply(403, { error: 'Local access only.' }) }
    if (!loopback(url.hostname) || !loopback(incoming.socket.remoteAddress)
      || incoming.headers.origin !== url.origin) return reply(403, { error: 'Local access only.' })
    if (!['/__local-ai/notice-extract', '/__local-ai/briefing', '/__local-ai/status'].includes(url.pathname)) return reply(404, { error: 'Unknown local AI endpoint.' })
    if (incoming.method !== 'POST') return reply(405, { error: 'Use POST.' })
    const token = incoming.headers.authorization?.match(/^Bearer ([\w.-]{1,8192})$/)?.[1]
    if (!token || !env.FIREBASE_PROJECT_ID) return reply(401, { error: 'Sign in again to use AI.' })
    let identity
    try { identity = await claimsFor(token, env.FIREBASE_PROJECT_ID) }
    catch { return reply(401, { error: 'Your sign-in could not be verified. Sign in again.' }) }
    try {
      if (identity.provider !== 'google.com' || !await allowlisted(env.FIREBASE_PROJECT_ID, identity.uid, token)) {
        return reply(403, { error: 'This Google account needs Firebase admin access.' })
      }
      const now = Date.now()
      const previous = limits.get(identity.uid)
      const limit = previous?.expires > now ? previous : { count: 0, expires: now + 60_000 }
      if (limit.count >= 6) return reply(429, { error: 'Please wait a minute before reading another update.' })
      limit.count++
      if (limits.size >= 200 && !limits.has(identity.uid)) limits.delete(limits.keys().next().value)
      limits.set(identity.uid, limit)
      if (url.pathname === '/__local-ai/status') return reply(200, {
        geminiConfigured: !!env.GEMINI_API_KEY && !!env.GEMINI_MODEL,
        model: env.GEMINI_MODEL ?? '', appCheckVerified: false, local: true,
      })
      if (!env.GEMINI_API_KEY || !/^[a-zA-Z0-9.-]{1,100}$/.test(env.GEMINI_MODEL ?? '')) {
        return reply(503, { error: 'Add GEMINI_API_KEY to worker/.dev.vars and restart npm run dev.' })
      }
      const request = new Request(url, { method: 'POST', headers: incoming.headers,
        body: Readable.toWeb(incoming), duplex: 'half' })
      let input
      try { input = await readInput(request, url.pathname === '/__local-ai/briefing' ? 1024 : 2_850_000) }
      catch { return reply(400, { error: 'Use valid text or a JPG/PNG image up to 2 MiB.' }) }
      if (url.pathname === '/__local-ai/briefing') {
        if (!validAIRequest(input)) return reply(400, { error: 'Use valid briefing metrics only.' })
        return reply(200, { guidance: await readAdminBriefing(input, env) })
      }
      if (!object(input) || Object.keys(input).some(key => !['text', 'image', 'direction'].includes(key))
        || !isDirection(input.direction) || typeof input.text !== 'string' || input.text.length > 8000
        || !input.text.trim() && !input.image || input.image !== undefined && !validateImage(input.image)) {
        return reply(400, { error: 'Choose a direction and enter text or a valid JPG/PNG image.' })
      }
      return reply(200, await readTransportUpdate(input, env))
    } catch {
      return reply(502, { error: 'AI could not read this update. Your message is kept; please try again.' })
    }
  }
}
