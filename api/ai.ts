import { env } from 'node:process'
import { handleVercelAI } from '../worker/vercel.ts'

export default {
  fetch(request: Request) {
    return handleVercelAI(request, {
      APP_ORIGIN: env.APP_ORIGIN ?? '',
      FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID ?? '',
      FIREBASE_PROJECT_NUMBER: env.FIREBASE_PROJECT_NUMBER ?? '',
      FIREBASE_APP_ID: env.FIREBASE_APP_ID ?? '',
      GEMINI_MODEL: env.GEMINI_MODEL,
      GEMINI_API_KEY: env.GEMINI_API_KEY,
    })
  },
}
