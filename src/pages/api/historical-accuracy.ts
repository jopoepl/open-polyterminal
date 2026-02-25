import type { NextApiRequest, NextApiResponse } from 'next'
import { CITY_CONFIG, getStationRecordByCity } from '@/lib/weather/stations'
import { computeMetrics, fahrenheitToCelsius } from '@/lib/accuracy/calculations'
import type {
  HistoricalAccuracyResponse,
  HistoricalPeriod,
  HistoricalScoringMode,
  ModelAccuracyRow,
  HistoricalDailySeriesPoint,
  HistoricalHourlyDaySeries,
} from '@/lib/accuracy/types'

const HISTORICAL_FORECAST_API = 'https://historical-forecast-api.open-meteo.com/v1/forecast'
const IOWA_MESONET_API = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py'

const MODEL_IDS: Record<string, string> = {
  GFS: 'gfs_seamless',
  ECMWF: 'ecmwf_ifs025',
  ICON: 'icon_seamless',
  GEM: 'gem_seamless',
  JMA: 'jma_seamless',
  UKMO: 'ukmo_seamless',
  ARPEGE: 'arpege_seamless',
}

const PERIOD_DAYS: Record<HistoricalPeriod, number> = {
  yesterday: 1,
  '3d': 3,
  '5d': 5,
  '1w': 7,
  '10d': 10,
  '15d': 15,
  '1m': 30,
}

const DAY_MS = 24 * 60 * 60 * 1000
const MIN_SAMPLES_PER_MODEL = 3
const SCORING_MODES: HistoricalScoringMode[] = ['day_ahead', 'latest_available']

const RESPONSE_CACHE = new Map<string, { data: HistoricalAccuracyResponse; ts: number }>()

function round(value: number, digits: number = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function parseCsv(csv: string): Array<Record<string, string>> {
  const lines = csv.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(column => column.trim())
  const rows: Array<Record<string, string>> = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',')
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || '').trim()
    }
    rows.push(row)
  }

  return rows
}

function toISODateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find(part => part.type === 'year')?.value || '1970'
  const month = parts.find(part => part.type === 'month')?.value || '01'
  const day = parts.find(part => part.type === 'day')?.value || '01'
  return `${year}-${month}-${day}`
}

function shiftDate(dateStr: string, deltaDays: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day) + deltaDays * DAY_MS)
  return shifted.toISOString().slice(0, 10)
}

function dateRange(start: string, end: string): string[] {
  const result: string[] = []
  let cursor = start
  while (cursor <= end) {
    result.push(cursor)
    cursor = shiftDate(cursor, 1)
  }
  return result
}

function toLocalDateHourInTimezone(date: Date, timezone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const year = parts.find(part => part.type === 'year')?.value || '1970'
  const month = parts.find(part => part.type === 'month')?.value || '01'
  const day = parts.find(part => part.type === 'day')?.value || '01'
  const hourRaw = parts.find(part => part.type === 'hour')?.value || '00'
  const hour = Math.max(0, Math.min(23, Number(hourRaw)))

  return { date: `${year}-${month}-${day}`, hour: Number.isFinite(hour) ? hour : 0 }
}

function applyScoringMode(
  forecastByModel: Map<string, Map<string, number>>,
  scoringMode: HistoricalScoringMode
): Map<string, Map<string, number>> {
  if (scoringMode !== 'day_ahead') return forecastByModel

  const shiftedByModel = new Map<string, Map<string, number>>()
  for (const [model, byDate] of forecastByModel.entries()) {
    const shifted = new Map<string, number>()
    for (const [date, value] of byDate.entries()) {
      shifted.set(shiftDate(date, 1), value)
    }
    shiftedByModel.set(model, shifted)
  }
  return shiftedByModel
}

async function fetchJson(url: string, timeoutMs: number = 10000): Promise<any | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(url: string, timeoutMs: number = 15000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchObservedHighs(
  icaoCode: string,
  timezone: string,
  startDate: string,
  endDate: string,
  unit: 'C' | 'F'
): Promise<Map<string, { high: number; highAt: string | null; count: number }>> {
  // Use explicit UTC bounds to avoid ambiguous day-end behavior in year/month/day params.
  const sts = `${shiftDate(startDate, -1)}T00:00:00Z`
  const ets = `${shiftDate(endDate, 2)}T00:00:00Z`
  const baseParams = new URLSearchParams({
    station: icaoCode,
    data: 'tmpf',
    tz: 'Etc/UTC',
    format: 'onlycomma',
    latlon: 'no',
    elev: 'no',
    direct: 'no',
    sts,
    ets,
  })

  // Include routine and special METAR reports for better daily peak capture.
  const url = `${IOWA_MESONET_API}?${baseParams.toString()}&report_type=3&report_type=4`
  const csv = await fetchText(url)
  if (!csv) return new Map()

  const rows = parseCsv(csv)
  const highs = new Map<string, { high: number; highAt: string | null; count: number }>()

  for (const row of rows) {
    const valid = row.valid || row.time || ''
    if (!valid) continue

    const parsed = new Date(valid.includes('T') ? valid : valid.replace(' ', 'T') + 'Z')
    if (Number.isNaN(parsed.getTime())) continue

    const tempF = Number(row.tmpf)
    if (!Number.isFinite(tempF)) continue

    const localDate = toISODateInTimezone(parsed, timezone)
    if (localDate < startDate || localDate > endDate) continue

    const temp = unit === 'C' ? fahrenheitToCelsius(tempF) : round(tempF, 1)
    const previous = highs.get(localDate)
    if (previous === undefined) {
      highs.set(localDate, {
        high: temp,
        highAt: parsed.toISOString(),
        count: 1,
      })
      continue
    }

    previous.count += 1
    if (temp > previous.high) {
      previous.high = temp
      previous.highAt = parsed.toISOString()
    }
  }

  return highs
}

async function fetchObservedHourly(
  icaoCode: string,
  timezone: string,
  startDate: string,
  endDate: string,
  unit: 'C' | 'F'
): Promise<Map<string, Map<number, number>>> {
  const sts = `${shiftDate(startDate, -1)}T00:00:00Z`
  const ets = `${shiftDate(endDate, 2)}T00:00:00Z`
  const baseParams = new URLSearchParams({
    station: icaoCode,
    data: 'tmpf',
    tz: 'Etc/UTC',
    format: 'onlycomma',
    latlon: 'no',
    elev: 'no',
    direct: 'no',
    sts,
    ets,
  })

  const url = `${IOWA_MESONET_API}?${baseParams.toString()}&report_type=3&report_type=4`
  const csv = await fetchText(url)
  if (!csv) return new Map()

  const rows = parseCsv(csv)
  const buckets = new Map<string, Map<number, { sum: number; count: number }>>()

  for (const row of rows) {
    const valid = row.valid || row.time || ''
    if (!valid) continue

    const parsed = new Date(valid.includes('T') ? valid : valid.replace(' ', 'T') + 'Z')
    if (Number.isNaN(parsed.getTime())) continue

    const tempF = Number(row.tmpf)
    if (!Number.isFinite(tempF)) continue

    const local = toLocalDateHourInTimezone(parsed, timezone)
    if (local.date < startDate || local.date > endDate) continue

    const temp = unit === 'C' ? fahrenheitToCelsius(tempF) : round(tempF, 1)
    const dayBucket = buckets.get(local.date) ?? new Map<number, { sum: number; count: number }>()
    if (!buckets.has(local.date)) buckets.set(local.date, dayBucket)
    const hourBucket = dayBucket.get(local.hour) ?? { sum: 0, count: 0 }
    hourBucket.sum += temp
    hourBucket.count += 1
    dayBucket.set(local.hour, hourBucket)
  }

  const result = new Map<string, Map<number, number>>()
  for (const [date, dayBucket] of buckets.entries()) {
    const day = new Map<number, number>()
    for (const [hour, bucket] of dayBucket.entries()) {
      if (bucket.count <= 0) continue
      day.set(hour, round(bucket.sum / bucket.count, 1))
    }
    result.set(date, day)
  }

  return result
}

async function fetchForecastHighs(
  lat: number,
  lon: number,
  timezone: string,
  startDate: string,
  endDate: string,
  unit: 'C' | 'F'
): Promise<Map<string, Map<string, number>>> {
  const modelIds = Object.values(MODEL_IDS).join(',')
  const tempUnit = unit === 'F' ? 'fahrenheit' : 'celsius'
  const url = `${HISTORICAL_FORECAST_API}?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max&models=${modelIds}&temperature_unit=${tempUnit}&timezone=${encodeURIComponent(timezone)}`

  const data = await fetchJson(url, 15000)
  const result = new Map<string, Map<string, number>>()
  if (!data?.daily) return result

  const dates: string[] = Array.isArray(data.daily.time) ? data.daily.time : []
  for (const model of Object.keys(MODEL_IDS)) {
    const modelId = MODEL_IDS[model]
    const key = `temperature_2m_max_${modelId}`
    const values: Array<number | null> = Array.isArray(data.daily[key]) ? data.daily[key] : []
    const byDate = new Map<string, number>()

    for (let i = 0; i < dates.length; i++) {
      const value = values[i]
      if (typeof value === 'number' && Number.isFinite(value)) {
        byDate.set(dates[i], round(value, 1))
      }
    }

    result.set(model, byDate)
  }

  return result
}

async function fetchForecastHourly(
  lat: number,
  lon: number,
  timezone: string,
  fetchStartDate: string,
  fetchEndDate: string,
  targetStartDate: string,
  targetEndDate: string,
  scoringMode: HistoricalScoringMode,
  unit: 'C' | 'F'
): Promise<Map<string, Map<string, Map<number, number>>>> {
  const modelIds = Object.values(MODEL_IDS).join(',')
  const tempUnit = unit === 'F' ? 'fahrenheit' : 'celsius'
  const url = `${HISTORICAL_FORECAST_API}?latitude=${lat}&longitude=${lon}&start_date=${fetchStartDate}&end_date=${fetchEndDate}&hourly=temperature_2m&models=${modelIds}&temperature_unit=${tempUnit}&timezone=${encodeURIComponent(timezone)}`

  const data = await fetchJson(url, 15000)
  const result = new Map<string, Map<string, Map<number, number>>>()
  if (!data?.hourly) return result

  const times: string[] = Array.isArray(data.hourly.time) ? data.hourly.time : []

  for (const model of Object.keys(MODEL_IDS)) {
    const modelId = MODEL_IDS[model]
    const key = `temperature_2m_${modelId}`
    const values: Array<number | null> = Array.isArray(data.hourly[key]) ? data.hourly[key] : []
    const byDate = new Map<string, Map<number, number>>()

    for (let i = 0; i < Math.min(times.length, values.length); i++) {
      const value = values[i]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue

      const timeStr = times[i]
      const datePart = timeStr.slice(0, 10)
      const hourPart = Number(timeStr.slice(11, 13))
      if (!Number.isFinite(hourPart) || hourPart < 0 || hourPart > 23) continue

      const targetDate = scoringMode === 'day_ahead' ? shiftDate(datePart, 1) : datePart
      if (targetDate < targetStartDate || targetDate > targetEndDate) continue

      const day = byDate.get(targetDate) ?? new Map<number, number>()
      day.set(hourPart, round(value, 1))
      byDate.set(targetDate, day)
    }

    result.set(model, byDate)
  }

  return result
}

function resolvePeriodWindow(period: HistoricalPeriod, timezone: string): { start: string; end: string; days: number } {
  const todayLocal = toISODateInTimezone(new Date(), timezone)
  const end = shiftDate(todayLocal, -1)
  const days = PERIOD_DAYS[period]
  const start = shiftDate(end, -(days - 1))
  return { start, end, days }
}

function resolveCacheTtlMs(period: HistoricalPeriod): number {
  if (period === 'yesterday') return 60 * 1000
  if (period === '3d' || period === '5d') return 3 * 60 * 1000
  return 5 * 60 * 1000
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const city = String(req.query.city || '')
  const period = String(req.query.period || '1w') as HistoricalPeriod
  const scoringMode = String(req.query.scoring || 'day_ahead') as HistoricalScoringMode
  const unit = (String(req.query.unit || 'F').toUpperCase() === 'C' ? 'C' : 'F') as 'C' | 'F'
  const resolution = 'daily' as const

  if (!city) {
    return res.status(400).json({ error: 'city is required' })
  }

  if (!(period in PERIOD_DAYS)) {
    return res.status(400).json({ error: 'invalid period' })
  }
  if (!SCORING_MODES.includes(scoringMode)) {
    return res.status(400).json({ error: 'invalid scoring mode' })
  }

  const cityConfig = CITY_CONFIG[city]
  const station = getStationRecordByCity(city)
  if (!cityConfig || !station || !station.icaoCode) {
    return res.status(400).json({ error: 'Unknown city or missing station metadata' })
  }

  const cacheKey = `${city}-${period}-${unit}-${resolution}-${scoringMode}`
  const ttl = resolveCacheTtlMs(period)
  const cached = RESPONSE_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.ts < ttl) {
    return res.status(200).json(cached.data)
  }

  try {
    const window = resolvePeriodWindow(period, cityConfig.tz)
    const forecastWindowStart = scoringMode === 'day_ahead' ? shiftDate(window.start, -1) : window.start
    const forecastWindowEnd = scoringMode === 'day_ahead' ? shiftDate(window.end, -1) : window.end
    const hourlyDays = Math.min(7, window.days)
    const hourlyEnd = window.end
    const hourlyStart = shiftDate(hourlyEnd, -(hourlyDays - 1))
    const hourlyForecastStart = scoringMode === 'day_ahead' ? shiftDate(hourlyStart, -1) : hourlyStart
    const hourlyForecastEnd = scoringMode === 'day_ahead' ? shiftDate(hourlyEnd, -1) : hourlyEnd

    const [observedHighs, rawForecastHighs, observedHourly, forecastHourly] = await Promise.all([
      fetchObservedHighs(station.icaoCode, cityConfig.tz, window.start, window.end, unit),
      fetchForecastHighs(
        cityConfig.geocode.lat,
        cityConfig.geocode.lon,
        cityConfig.tz,
        forecastWindowStart,
        forecastWindowEnd,
        unit
      ),
      fetchObservedHourly(station.icaoCode, cityConfig.tz, hourlyStart, hourlyEnd, unit),
      fetchForecastHourly(
        cityConfig.geocode.lat,
        cityConfig.geocode.lon,
        cityConfig.tz,
        hourlyForecastStart,
        hourlyForecastEnd,
        hourlyStart,
        hourlyEnd,
        scoringMode,
        unit
      ),
    ])
    const forecastHighs = applyScoringMode(rawForecastHighs, scoringMode)

    const dates = dateRange(window.start, window.end)
    const dailySeries: HistoricalDailySeriesPoint[] = dates.map(date => {
      const observedStats = observedHighs.get(date)
      const observedHigh = observedStats?.high ?? null
      const observedHighAt = observedStats?.highAt ?? null
      const observationCount = observedStats?.count ?? 0
      const models = Object.keys(MODEL_IDS).map(model => {
        const predictedHigh = forecastHighs.get(model)?.get(date) ?? null
        const error = (predictedHigh !== null && observedHigh !== null)
          ? round(predictedHigh - observedHigh, 1)
          : null
        return { model, predictedHigh, error }
      })

      return { date, observedHigh, observedHighAt, observationCount, models }
    })

    const observedDayCount = dailySeries.filter(row => row.observedHigh !== null).length
    const accuracyThreshold = unit === 'F' ? 2 : 1
    const hourlyDates = dateRange(hourlyStart, hourlyEnd)
    const hourlySeries: HistoricalHourlyDaySeries[] = hourlyDates.map(date => {
      const observedByHour = observedHourly.get(date) ?? new Map<number, number>()

      const models = Object.keys(MODEL_IDS).map(model => {
        const forecastByHour = forecastHourly.get(model)?.get(date) ?? new Map<number, number>()
        const points = Array.from({ length: 24 }).map((_, hour) => {
          const observed = observedByHour.get(hour) ?? null
          const forecast = forecastByHour.get(hour) ?? null
          const error = (observed !== null && forecast !== null) ? round(forecast - observed, 1) : null
          return { hour, observed, forecast, error }
        })

        const errors = points.map(point => point.error).filter((value): value is number => value !== null)
        const sampleCount = errors.length
        const meanError = sampleCount > 0 ? round(errors.reduce((acc, value) => acc + value, 0) / sampleCount, 2) : null
        const mae = sampleCount > 0 ? round(errors.reduce((acc, value) => acc + Math.abs(value), 0) / sampleCount, 2) : null
        const warmHours = errors.filter(value => value > 0).length
        const coldHours = errors.filter(value => value < 0).length

        return {
          model,
          points,
          meanError,
          mae,
          sampleCount,
          warmHours,
          coldHours,
        }
      })

      return {
        date,
        observedHourCount: observedByHour.size,
        models,
      }
    })

    const modelAccuracy: ModelAccuracyRow[] = Object.keys(MODEL_IDS).map(model => {
      const errors: number[] = []
      const errorTrend: Array<{ date: string; error: number }> = []

      for (const day of dailySeries) {
        const point = day.models.find(entry => entry.model === model)
        if (point?.error === null || point?.error === undefined) continue
        errors.push(point.error)
        errorTrend.push({ date: day.date, error: point.error })
      }

      const metrics = computeMetrics(errors, accuracyThreshold)
      const sampleCount = errors.length
      const coveragePct = observedDayCount > 0 ? round((sampleCount / observedDayCount) * 100, 1) : 0
      const eligible = sampleCount >= MIN_SAMPLES_PER_MODEL

      return {
        model,
        mae: metrics?.mae ?? null,
        rmse: metrics?.rmse ?? null,
        bias: metrics?.bias ?? null,
        accuracyPct: metrics?.accuracyPct ?? null,
        sampleCount,
        coveragePct,
        eligible,
        rank: null,
        errorTrend,
      }
    })

    const sorted = [...modelAccuracy].sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
      const aMae = a.mae ?? Number.POSITIVE_INFINITY
      const bMae = b.mae ?? Number.POSITIVE_INFINITY
      if (aMae !== bMae) return aMae - bMae
      return a.model.localeCompare(b.model)
    })

    let rank = 1
    for (const row of sorted) {
      if (!row.eligible || row.mae === null) {
        row.rank = null
        continue
      }
      row.rank = rank
      rank += 1
    }

    const best = sorted.find(row => row.rank === 1 && row.mae !== null) || null

    const warnings: string[] = []
    if (scoringMode === 'day_ahead') {
      warnings.push('Strict day-ahead scoring enabled: each day is evaluated against the previous local day forecast (+24h lead).')
    }
    if (observedDayCount === 0) {
      warnings.push('No observed METAR temperature coverage found in selected period.')
    } else if (observedDayCount < window.days) {
      warnings.push(`Observed coverage is partial: ${observedDayCount}/${window.days} days.`)
    }
    const lowCountDays = dailySeries.filter(row => row.observationCount > 0 && row.observationCount < 8).map(row => row.date)
    if (lowCountDays.length > 0) {
      warnings.push(`Low METAR sample count on: ${lowCountDays.join(', ')}.`)
    }
    const lowHourlyDays = hourlySeries
      .filter(day => day.observedHourCount > 0 && day.observedHourCount < 12)
      .map(day => day.date)
    if (lowHourlyDays.length > 0) {
      warnings.push(`Sparse hourly METAR coverage on: ${lowHourlyDays.join(', ')}.`)
    }

    const missingModels = sorted.filter(row => row.sampleCount === 0).map(row => row.model)
    if (missingModels.length > 0) {
      warnings.push(`No forecast coverage for: ${missingModels.join(', ')}.`)
    }

    const insufficientModels = sorted.filter(row => row.sampleCount > 0 && !row.eligible).map(row => row.model)
    if (insufficientModels.length > 0) {
      warnings.push(`Insufficient samples for ranking: ${insufficientModels.join(', ')}.`)
    }

    const response: HistoricalAccuracyResponse = {
      station: {
        city: station.city,
        icaoCode: station.icaoCode,
        timezone: cityConfig.tz,
        coordinates: { ...cityConfig.geocode },
      },
      period: {
        key: period,
        start: window.start,
        end: window.end,
        days: window.days,
      },
      resolution,
      policy: {
        evaluationWindow: 'completed_local_days',
        observationSource: 'iowa_mesonet_metar',
        forecastSource: 'open_meteo_historical_forecast',
        scoringMode,
        leadTimeHours: scoringMode === 'day_ahead' ? 24 : 0,
        minSamplesPerModel: MIN_SAMPLES_PER_MODEL,
        accuracyThresholdDegrees: accuracyThreshold,
        stationTimezone: cityConfig.tz,
      },
      dailySeries,
      hourly: {
        start: hourlyStart,
        end: hourlyEnd,
        days: hourlyDays,
        defaultModel: best?.model ?? null,
        series: hourlySeries,
      },
      modelAccuracy: sorted,
      bestModel: best ? { name: best.model, mae: best.mae! } : null,
      warnings,
    }

    RESPONSE_CACHE.set(cacheKey, { data: response, ts: Date.now() })
    return res.status(200).json(response)
  } catch {
    return res.status(500).json({ error: 'Failed to calculate historical accuracy' })
  }
}
