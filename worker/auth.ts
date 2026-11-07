export type Identity = { uid: string; provider?: string }
type SigningKey = JsonWebKey & { kid: string }
const caches = new Map<string, { expires: number; keys: SigningKey[] }>()

function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0))
}

async function verifiedJwt(token: string, url: string, appCheck = false) {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some(part => !/^[\w-]+$/.test(part))) throw new Error('Invalid token')
  const [header, payload, signature] = parts
  const decoder = new TextDecoder()
  const { alg, kid, typ } = JSON.parse(decoder.decode(decode(header)))
  if (alg !== 'RS256' || typeof kid !== 'string' || appCheck && typ !== 'JWT') throw new Error('Invalid token header')
  let cache = caches.get(url)
  if (!cache || Date.now() >= cache.expires || !cache.keys.some(key => key.kid === kid)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000) })
    if (!response.ok) throw new Error('Signing keys unavailable')
    const { keys } = await response.json() as { keys: SigningKey[] }
    const maxAge = Math.min(21_600, Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1] ?? 60))
    cache = { keys, expires: Date.now() + maxAge * 1_000 }
    caches.set(url, cache)
  }
  const jwk = cache.keys.find(key => key.kid === kid)
  if (!jwk) throw new Error('Unknown signing key')
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
  const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify'])
  if (!await crypto.subtle.verify(algorithm, key, decode(signature), new TextEncoder().encode(`${header}.${payload}`))) throw new Error('Invalid signature')
  return JSON.parse(decoder.decode(decode(payload))) as Record<string, unknown>
}

export async function claimsFor(token: string, project: string): Promise<Identity> {
  const claims = await verifiedJwt(token, 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
  const now = Date.now() / 1_000
  if (claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`
    || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128
    || typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.iat !== 'number' || claims.iat > now
    || typeof claims.auth_time !== 'number' || claims.auth_time > now) throw new Error('Invalid token claims')
  return { uid: claims.sub, provider: (claims.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider }
}

export async function verifyAppCheck(token: string, projectNumber: string, appId: string) {
  const claims = await verifiedJwt(token, 'https://firebaseappcheck.googleapis.com/v1/jwks', true)
  const now = Date.now() / 1_000
  if (!projectNumber || !appId || claims.iss !== `https://firebaseappcheck.googleapis.com/${projectNumber}`
    || !Array.isArray(claims.aud) || !claims.aud.includes(`projects/${projectNumber}`) || claims.sub !== appId
    || typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.iat !== 'number' || claims.iat > now) throw new Error('Invalid App Check token')
}

export async function allowlisted(project: string, uid: string, token: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/admins/${encodeURIComponent(uid)}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4_000) })
  return response.ok
}

export async function readInput(request: Request, limit = 1024, requireJson = true) {
  const length = request.headers.get('Content-Length')
  if (length && Number(length) > limit) throw new Error('Request too large')
  if (requireJson && !request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('JSON required')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Missing request')
  const decoder = new TextDecoder()
  let data = ''
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return JSON.parse(data + decoder.decode()) as unknown
    size += value.byteLength
    if (size > limit) { await reader.cancel(); throw new Error('Request too large') }
    data += decoder.decode(value, { stream: true })
  }
}
