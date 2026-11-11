export type Point = { latitude: number; longitude: number }

const pickupRadiusMetres = 50
const maxAccuracyMetres = 50

function hasAccurateLocation(accuracy: number) {
  return Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= maxAccuracyMetres
}

export function withinPickup(point: Point, reading: Point & { accuracy: number }) {
  const radians = Math.PI / 180
  const lat = (reading.latitude - point.latitude) * radians
  const lon = (reading.longitude - point.longitude) * radians
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(point.latitude * radians) * Math.cos(reading.latitude * radians) * Math.sin(lon / 2) ** 2
  const distance = 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, a)))
  return hasAccurateLocation(reading.accuracy) && distance <= pickupRadiusMetres
}

export async function confirmPickup(point: Point) {
  if (globalThis.isSecureContext === false) throw new Error('Location access requires HTTPS or localhost.')
  if (!navigator.geolocation) throw new Error('Location is unavailable in this browser.')
  await new Promise<void>((resolve, reject) => navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      if (!hasAccurateLocation(coords.accuracy)) {
        const reported = Number.isFinite(coords.accuracy) && coords.accuracy >= 0 ? `${Math.ceil(coords.accuracy)} metres` : 'unavailable'
        reject(new Error(`Your location is too imprecise (reported accuracy: ${reported}). Check-in needs ${maxAccuracyMetres} metres or better. Enable precise location and try again.`))
      } else if (withinPickup(point, coords)) resolve()
      else reject(new Error(`Your reported location is outside the pickup area. Move within ${pickupRadiusMetres} metres of this pickup and try again.`))
    },
    error => reject(new Error(error.code === 1 ? 'Location permission was denied.'
      : error.code === 3 ? 'The location request timed out.' : 'Your location is unavailable.')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
  ))
}
