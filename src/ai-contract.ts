export type AIRequest = { kind: 'briefing'; metrics: { apu: RouteMetrics; lrt: RouteMetrics } }

export type RouteMetrics = { current: number; previous: number; peakHour: number; peakCount: number }

function integerRecord(value: unknown, bounds: Record<string, [number, number]>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === Object.keys(bounds).length && Object.entries(bounds).every(([key, [min, max]]) => {
    const number = record[key]
    return typeof number === 'number' && Number.isSafeInteger(number) && number >= min && number <= max
  })
}

export function validAIRequest(value: unknown): value is AIRequest {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 2) return false
  const { kind, metrics } = value as { kind?: unknown; metrics?: unknown }
  if (kind !== 'briefing' || !metrics || typeof metrics !== 'object' || Object.keys(metrics).length !== 2) return false
  const routes = metrics as Record<string, unknown>
  const bounds: Record<string, [number, number]> = {
    current: [0, Number.MAX_SAFE_INTEGER], previous: [0, Number.MAX_SAFE_INTEGER],
    peakHour: [-1, 23], peakCount: [0, Number.MAX_SAFE_INTEGER],
  }
  return integerRecord(routes.apu, bounds) && integerRecord(routes.lrt, bounds)
}

export function promptFor(request: AIRequest) {
  return 'Summarize the two routes using the supplied check-in totals and peak counts. Current and previous refer to successive seven-day periods. A peak hour of minus one means no check-ins. The UI already shows the figures.'
    + ' Do not predict additional departures, invent facts, or include numbers. '
    + 'Return only a JSON object with one key, guidance, containing one or two short plain text sentences. '
    + JSON.stringify(request.metrics)
}

export function parseGuidance(raw: string) {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || !('guidance' in value)
    || typeof value.guidance !== 'string') throw new Error('Invalid guidance')
  const guidance = value.guidance.trim()
  if (!guidance || guidance.length > 400 || /[\p{N}<>\r\n]/u.test(guidance)) throw new Error('Invalid guidance')
  return guidance
}

export async function tryProviders(
  input: AIRequest,
  primary: (input: AIRequest) => Promise<string>,
  backup: (input: AIRequest) => Promise<string>,
) {
  try {
    return await primary(input)
  } catch {
    try {
      return await backup(input)
    } catch {
      return undefined
    }
  }
}
