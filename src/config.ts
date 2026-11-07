import type { Point } from './pickup'
import type { RouteId } from './schedule'

function numeric(value: string | undefined, min: number, max: number) {
  if (!value?.trim()) return
  const number = Number(value)
  if (Number.isFinite(number) && number >= min && number <= max) return number
}

function pickup(latitudeValue: string, longitudeValue: string): Point | undefined {
  const latitude = numeric(latitudeValue, -90, 90)
  const longitude = numeric(longitudeValue, -180, 180)
  if (latitude !== undefined && longitude !== undefined) return { latitude, longitude }
}

const env = import.meta.env
export const pickups: Record<RouteId, Point | undefined> = {
  apu: pickup(env.VITE_APU_LATITUDE, env.VITE_APU_LONGITUDE),
  lrt: pickup(env.VITE_LRT_LATITUDE, env.VITE_LRT_LONGITUDE),
}

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}
