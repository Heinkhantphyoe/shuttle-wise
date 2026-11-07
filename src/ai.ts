import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai'
import type { User } from 'firebase/auth'
import { doc, getDocFromServer } from 'firebase/firestore'
import { app, appCheck, db } from './firebase'
import { parseGuidance, promptFor, tryProviders, validAIRequest, type AIRequest } from './ai-contract'

const workerUrl = import.meta.env.VITE_AI_WORKER_URL
const model = import.meta.env.VITE_GEMINI_MODEL

async function gemini(request: AIRequest) {
  if (!app || !appCheck || !model) throw new Error('Gemini is unconfigured.')
  const ai = getAI(app, { backend: new GoogleAIBackend() })
  const generator = getGenerativeModel(ai, {
    model,
    generationConfig: { responseMimeType: 'application/json' },
  }, { timeout: 6_000 })
  const result = await generator.generateContent(promptFor(request))
  return parseGuidance(result.response.text())
}

async function openRouter(request: AIRequest, user: User) {
  if (!workerUrl) throw new Error('OpenRouter is unconfigured.')
  const response = await fetch(workerUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error('The backup provider is unavailable.')
  return parseGuidance(await response.text())
}

export async function guidance(request: AIRequest, user: User) {
  if (!validAIRequest(request)) return
  if (!db || (await user.getIdTokenResult()).signInProvider !== 'google.com'
    || !(await getDocFromServer(doc(db, 'admins', user.uid))).exists()) return
  return tryProviders(request, gemini, input => openRouter(input, user))
}
