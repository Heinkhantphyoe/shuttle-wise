import { claimsFor, allowlisted, readInput } from './auth.ts'
import { handleTravel, type TravelEnv } from './travel.ts'
import { parseGuidance, promptFor, validAIRequest } from '../src/ai-contract.ts'

type Env = TravelEnv & {
  FIREBASE_PROJECT_ID: string
  APP_ORIGIN: string
  OPENROUTER_API_KEY: string
  UID_RATE_LIMIT: { limit(input: { key: string }): Promise<{ success: boolean }> }
}
export default {
  async fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname.startsWith('/ai/')) return handleTravel(request, env)
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
      const input: unknown = await readInput(request, 1024, false).catch(() => undefined)
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
