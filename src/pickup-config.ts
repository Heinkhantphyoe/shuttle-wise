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
  const profiles = {
    apu: env.VITE_APU_PICKUP_PROFILE?.trim() || profile,
    lrt: env.VITE_LRT_PICKUP_PROFILE?.trim() || profile,
  }
  const savanna = point(env, 'VITE_SAVANNA')
  const selected = (route: RouteId) => profiles[route] === 'original' ? savedPickups[route]
    : profiles[route] === 'savanna' ? savanna : undefined
  const pickups = { apu: selected('apu'), lrt: selected('lrt') }
  const temporaryRoutes = (['apu', 'lrt'] as const).filter(route => profiles[route] === 'savanna')
  const temporaryPickupScope = temporaryRoutes.length === 2 ? 'Both routes' : temporaryRoutes[0] === 'apu' ? 'The APU route' : 'The LRT route'
  return { savedPickups, pickups, temporaryPickup: temporaryRoutes.length ? 'Savanna Bukit Jalil' : undefined, temporaryPickupScope }
}
