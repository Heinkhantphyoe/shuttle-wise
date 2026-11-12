import type { Point } from './pickup.ts'
import type { RouteId } from './schedule.ts'

type Environment = Record<string, string | undefined>

function coordinate(value: string | undefined, min: number, max: number) {
  if (!value?.trim()) return
  const number = Number(value)
  if (Number.isFinite(number) && number >= min && number <= max) return number
}

function point(env: Environment, prefix: string): Point | undefined {
  const latitude = coordinate(env[`${prefix}_LATITUDE`], -90, 90)
  const longitude = coordinate(env[`${prefix}_LONGITUDE`], -180, 180)
  if (latitude !== undefined && longitude !== undefined) return { latitude, longitude }
}

export function pickupConfiguration(env: Environment) {
  const savedPickups: Record<RouteId, Point | undefined> = {
    apu: point(env, 'VITE_APU'),
    lrt: point(env, 'VITE_LRT'),
  }
  const profile = env.VITE_PICKUP_PROFILE?.trim() || 'original'
  const savanna = profile === 'savanna' ? point(env, 'VITE_SAVANNA') : undefined
  const pickups: Record<RouteId, Point | undefined> = profile === 'original'
    ? savedPickups : { apu: savanna, lrt: savanna }
  return { savedPickups, pickups, temporaryPickup: profile === 'savanna' ? 'Savanna Bukit Jalil' : undefined }
}
