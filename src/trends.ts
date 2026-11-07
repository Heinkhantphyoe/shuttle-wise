import type { RouteMetrics } from './ai-contract'
import { serviceDay } from './schedule.ts'

const hourMs = 3_600_000
const dayMs = 24 * hourMs
export type Trend = { metrics: RouteMetrics; daily: number[] }

export function historyCutoff(now: number) {
  return new Date((serviceDay(now) - 13) * dayMs - 8 * hourMs)
}

export function summarize(times: number[], now: number): Trend {
  const day = serviceDay(now)
  const daily = Array<number>(14).fill(0)
  const hourly = Array<number>(24).fill(0)
  for (const time of times) {
    const index = serviceDay(time) - day + 13
    if (index < 0 || index >= daily.length || time > now) continue
    daily[index]++
    if (index >= 7) hourly[new Date(time + 8 * hourMs).getUTCHours()]++
  }
  const peakCount = Math.max(...hourly)
  const total = (counts: number[]) => counts.reduce((sum, count) => sum + count, 0)
  return { daily, metrics: {
    current: total(daily.slice(7)), previous: total(daily.slice(0, 7)),
    peakHour: peakCount ? hourly.indexOf(peakCount) : -1, peakCount,
  } }
}

export function syntheticTimes(now: number, afternoon: boolean) {
  const cutoff = historyCutoff(now).getTime()
  return Array.from({ length: 14 }, (_, index) => {
    const midnight = cutoff + index * dayMs
    const weekday = new Date(midnight + 8 * hourMs).getUTCDay()
    if (weekday === 0 || weekday === 6) return []
    return Array.from({ length: (index * 3 + (afternoon ? 4 : 1)) % 10 + 1 }, (_, count) =>
      midnight + (afternoon ? 16 : 8) * hourMs + count * 60_000)
  }).flat()
}
