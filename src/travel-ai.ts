import type { User } from 'firebase/auth'
import { getToken } from 'firebase/app-check'
import { appCheck, useEmulators } from './firebase'
import { parseAdvice, parseExtraction, scopeExtraction, type AffectedDirection, type Extraction } from './travel-contract'
import type { RouteId } from './schedule'
import { parseGuidance, type AIRequest } from './ai-contract'

const workerUrl = import.meta.env.VITE_AI_WORKER_URL
export const localAI = import.meta.env.DEV && import.meta.env.VITE_LOCAL_AI === true
  && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && !useEmulators
export const hostedAI = import.meta.env.VITE_AI_BACKEND === 'vercel' && !useEmulators
export const travelAIConfigured = localAI || (hostedAI || !!workerUrl) && !!appCheck && !useEmulators
export type NoticeImage = { mimeType: 'image/jpeg' | 'image/png'; data: string }

async function request(path: string, input: object, user: User, signal?: AbortSignal) {
  if (useEmulators) throw new Error('AI reading is unavailable in the local Firebase demo.')
  if (!localAI && !hostedAI && !workerUrl) throw new Error('AI server is not connected. Add VITE_AI_WORKER_URL and restart the app. See AI_SETUP.md.')
  if (!localAI && !appCheck) throw new Error('AI verification is not configured. Add VITE_RECAPTCHA_ENTERPRISE_SITE_KEY and restart the app. See AI_SETUP.md.')
  const [idToken, verification] = await Promise.all([user.getIdToken(), localAI ? undefined : getToken(appCheck!)])
  const base = new URL(localAI || hostedAI ? location.origin : workerUrl!)
  base.pathname = localAI ? path.replace('/ai/', '/__local-ai/') : path
  base.search = ''
  base.hash = ''
  const response = await fetch(base, {
    method: 'POST', headers: { Authorization: `Bearer ${idToken}`, ...(verification ? { 'X-Firebase-AppCheck': verification.token } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'AI is temporarily unavailable.')
  return result as unknown
}

export async function extractNotice(text: string, image: NoticeImage | undefined, direction: AffectedDirection, user: User): Promise<Extraction> {
  return scopeExtraction(parseExtraction(await request('/ai/notice-extract', { text, direction, ...(image ? { image } : {}) }, user)), direction)
}

export async function journeyAdvice(route: RouteId, fingerprint: string, evidenceIds: string[], user: User, signal: AbortSignal) {
  const result = await request('/ai/journey-advice', { route, fingerprint }, user, signal) as { fingerprint?: string; advice?: unknown }
  if (result.fingerprint !== fingerprint) throw new Error('Travel information changed. Showing calculated options.')
  return parseAdvice(result.advice, evidenceIds)
}

export async function travelAIStatus(user: User) {
  return await request('/ai/status', {}, user) as { geminiConfigured: boolean; model: string; appCheckVerified: boolean }
}

export async function localBriefing(input: AIRequest, user: User) {
  if (!localAI && !hostedAI) throw new Error('Server briefing is unavailable.')
  return parseGuidance(JSON.stringify(await request('/ai/briefing', input, user)))
}

export async function prepareNoticeImage(file: File): Promise<NoticeImage> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('Choose a JPEG or PNG up to 12 MiB. It will be resized before reading.')
  const image = await createImageBitmap(file)
  try {
    if (image.width < 1 || image.height < 1 || image.width * image.height > 40_000_000) throw new Error('This image is too large. Choose a smaller screenshot.')
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot read the screenshot. Use typed text.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/jpeg', .85).split(',')[1]
    if (!data || atob(data).length > 2 * 1024 * 1024) throw new Error('The resized image is still over 2 MiB. Crop it and try again.')
    return { mimeType: 'image/jpeg', data }
  } finally { image.close() }
}
