export type Point = { latitude: number; longitude: number }

export function withinPickup(point: Point, reading: Point & { accuracy: number }) {
  const radians = Math.PI / 180
  const lat = (reading.latitude - point.latitude) * radians
  const lon = (reading.longitude - point.longitude) * radians
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(point.latitude * radians) * Math.cos(reading.latitude * radians) * Math.sin(lon / 2) ** 2
  const distance = 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, a)))
  return Number.isFinite(reading.accuracy) && reading.accuracy >= 0 && reading.accuracy <= 30 && distance <= 30
}

export async function confirmPickup(point: Point) {
  if (!navigator.geolocation) throw new Error('Location is unavailable in this browser.')
  await new Promise<void>((resolve, reject) => navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      if (withinPickup(point, coords)) resolve()
      else reject(new Error('Move within 30 metres of this pickup and try again with better location accuracy.'))
    },
    error => reject(new Error(error.code === 1 ? 'Location permission was denied.'
      : error.code === 3 ? 'The location request timed out.' : 'Your location is unavailable.')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
  ))
}
