import { parseGuidance, promptFor, validAIRequest } from '../src/ai-contract.ts'

type Env = {
  FIREBASE_PROJECT_ID: string
  APP_ORIGIN: string
  OPENROUTER_API_KEY: string
  UID_RATE_LIMIT: { limit(input: { key: string }): Promise<{ success: boolean }> }
}
type Claims = { sub?: string; aud?: string; iss?: string; exp?: number; iat?: number; auth_time?: number; firebase?: { sign_in_provider?: string } }
type SigningKey = JsonWebKey & { kid: string }
const jwksUrl = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
let keyCache: { expires: number; keys: SigningKey[] } | undefined

function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0))
}

async function claimsFor(token: string, project: string) {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some(part => !/^[\w-]+$/.test(part))) throw new Error('Invalid token')
  const [header, payload, signature] = parts
  const decoder = new TextDecoder()
  const { alg, kid } = JSON.parse(decoder.decode(decode(header)))
  if (alg !== 'RS256' || typeof kid !== 'string') throw new Error('Invalid token header')
  if (!keyCache || Date.now() >= keyCache.expires) {
    const response = await fetch(jwksUrl, { signal: AbortSignal.timeout(4_000) })
    if (!response.ok) throw new Error('Signing keys unavailable')
    const { keys } = await response.json() as { keys: SigningKey[] }
    const maxAge = Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1] ?? 60)
    keyCache = { keys, expires: Date.now() + maxAge * 1_000 }
  }
  const jwk = keyCache.keys.find(key => key.kid === kid)
  if (!jwk) throw new Error('Unknown signing key')
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
  const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify'])
  if (!await crypto.subtle.verify(algorithm, key, decode(signature), new TextEncoder().encode(`${header}.${payload}`))) {
    throw new Error('Invalid signature')
  }
  const claims = JSON.parse(decoder.decode(decode(payload))) as Claims
  const now = Date.now() / 1_000
  if (claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`
    || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128
    || typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.iat !== 'number' || claims.iat > now
    || typeof claims.auth_time !== 'number' || claims.auth_time > now) throw new Error('Invalid token claims')
  return { uid: claims.sub, provider: claims.firebase?.sign_in_provider }
}

async function allowlisted(project: string, uid: string, token: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/admins/${encodeURIComponent(uid)}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4_000) })
  return response.ok
}

async function readInput(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let data = ''
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return JSON.parse(data + decoder.decode())
    size += value.byteLength
    if (size > 1024) {
      await reader.cancel()
      return
    }
    data += decoder.decode(value, { stream: true })
  }
}

export default {
  async fetch(request: Request, env: Env) {
    if (!env.APP_ORIGIN || request.headers.get('Origin') !== env.APP_ORIGIN) {
      return new Response(null, { status: 403 })
    }
    const headers = {
      'Access-Control-Allow-Origin': env.APP_ORIGIN,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    const reply = (status: number, body: object) => Response.json(body, { status, headers })
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' })
    const token = request.headers.get('Authorization')?.match(/^Bearer ([\w.-]{1,8192})$/)?.[1]
    if (!token || !env.FIREBASE_PROJECT_ID) return reply(401, { error: 'Authentication required' })
    let identity
    try {
      identity = await claimsFor(token, env.FIREBASE_PROJECT_ID)
    } catch {
      return reply(401, { error: 'Invalid authentication' })
    }
    try {
      if (!(await env.UID_RATE_LIMIT.limit({ key: identity.uid })).success) {
        return reply(429, { error: 'Rate limit exceeded' })
      }
      const input: unknown = await readInput(request).catch(() => undefined)
      if (!validAIRequest(input)) return reply(400, { error: 'Invalid metrics' })
      if (identity.provider !== 'google.com' || !await allowlisted(env.FIREBASE_PROJECT_ID, identity.uid, token)) {
        return reply(403, { error: 'Admin access required' })
      }
      if (!env.OPENROUTER_API_KEY) return reply(503, { error: 'Provider not configured' })
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(6_000),
        body: JSON.stringify({
          model: 'openrouter/free', max_tokens: 200,
          messages: [{ role: 'user', content: promptFor(input) }],
        }),
      })
      if (!response.ok) throw new Error('Provider failure')
      const result = await response.json() as { choices?: { message?: { content?: string } }[] }
      return reply(200, { guidance: parseGuidance(result.choices?.[0]?.message?.content ?? '') })
    } catch {
      return reply(502, { error: 'Backup provider unavailable' })
    }
  },
}
