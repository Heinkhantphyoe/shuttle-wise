export const routes = {
  apu: {
    origin: 'APU', destination: 'Bukit Jalil LRT',
    departures: [
      '10:35', '10:45', '11:30', '11:50', '12:10', '12:35', '12:50', '13:05',
      '13:10', '13:15', '13:30', '14:00', '14:15', '14:30', '14:45', '15:10',
      '15:20', '15:30', '15:45', '15:50', '16:00', '16:15', '16:30', '16:45',
      '16:50', '17:00', '17:10', '17:20', '17:30', '17:40', '18:00', '18:10',
      '18:15', '18:30', '18:40', '18:55', '19:15', '20:45', '21:45',
    ],
  },
  lrt: {
    origin: 'Bukit Jalil LRT', destination: 'APU',
    departures: [
      '07:30', '08:45', '09:00', '09:10', '09:20',
      '09:30', '09:50', '10:00', '10:05', '10:10', '10:15', '10:30', '10:35',
      '10:45', '11:00', '11:05', '11:10', '11:25', '11:40', '12:10', '12:30',
      '12:45', '13:00', '13:15', '13:20', '13:25', '13:40', '14:10', '14:25',
      '14:40', '15:05', '15:20', '15:40', '15:55', '16:10', '16:25', '17:10',
      '17:20', '17:30', '18:20',
    ],
  },
}

export type RouteId = keyof typeof routes
export const routeIds: RouteId[] = ['apu', 'lrt']
export const malaysiaZone = 'Asia/Kuala_Lumpur'
export const timetableSource = {
  version: 'V1_20261022',
  effectiveDate: '2026-10-22',
  url: 'https://publicwebsite-media.apu.edu.my/assets/2026-10/2026Oct22_APU-SHUTTLE-SERVICES.pdf',
}
export const routeLabel = (route: RouteId) => `${routes[route].origin} → ${routes[route].destination}`
const dayMs = 86_400_000
const offsetMs = 8 * 3_600_000

export function serviceDay(now: number) {
  return Math.floor((now + offsetMs) / dayMs)
}

export function weekday(day: number) {
  const dayOfWeek = new Date(day * dayMs).getUTCDay()
  return dayOfWeek >= 1 && dayOfWeek <= 5
}

export function departuresOn(route: RouteId, day: number) {
  if (!weekday(day)) return []
  const midnight = day * dayMs - offsetMs
  return routes[route].departures.map(time => {
    const [hour, minute] = time.split(':').map(Number)
    return midnight + (hour * 60 + minute) * 60_000
  })
}

export function serviceDate(now: number) {
  return new Date(now + offsetMs).toISOString().slice(0, 10)
}

export function timeOn(date: string, time: string) {
  return Date.parse(`${date}T${time}:00+08:00`)
}

export function continuousService(route: RouteId, now: number) {
  return route === 'lrt' && weekday(serviceDay(now))
    && now >= timeOn(serviceDate(now), '07:30') && now < timeOn(serviceDate(now), '08:45')
}

export function scheduleFor(route: RouteId, now: number) {
  const day = serviceDay(now)
  const today = departuresOn(route, day)
  const next = today.find(time => time >= now)
  let nextDay = day + 1
  while (!weekday(nextDay)) nextDay++
  return { today, next, nextWeekday: departuresOn(route, nextDay)[0] }
}

const timeFormat = new Intl.DateTimeFormat('en-MY', {
  timeZone: malaysiaZone, hour: 'numeric', minute: '2-digit', hour12: true,
})
const weekdayFormat = new Intl.DateTimeFormat('en-MY', { timeZone: malaysiaZone, weekday: 'long' })
export const formatTime = (time: number) => timeFormat.format(time)
export const formatWeekday = (time: number) => weekdayFormat.format(time)
