import type { NextApiRequest, NextApiResponse } from 'next'
import { CITY_CONFIG, extractCityFromText } from '@/lib/weather/stations'

const METAR_API = 'https://aviationweather.gov/api/data/metar'
const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'
const METAR_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.WEATHER_METAR_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.round(parsed) : 12000
})()

const WEATHER_CACHE = new Map<string, { data: any; ts: number }>()
const CACHE_TTL_MS = 60 * 1000

function daysBetweenUtc(dateStr: string) {
  const today = new Date()
  const target = new Date(`${dateStr}T00:00:00Z`)
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const diffMs = target.getTime() - utcToday.getTime()
  return diffMs / (1000 * 60 * 60 * 24)
}

function parseSkyCondition(clouds: Array<{ cover: string; base?: number }> | undefined): string | null {
  if (!clouds || !clouds.length) return 'Clear'
  const coverMap: Record<string, string> = {
    CLR: 'Clear',
    SKC: 'Clear',
    FEW: 'Few clouds',
    SCT: 'Scattered clouds',
    BKN: 'Mostly cloudy',
    OVC: 'Overcast'
  }
  const lowest = clouds[0]
  return coverMap[lowest.cover] || lowest.cover || null
}

async function fetchMetar(icaoCode: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), METAR_TIMEOUT_MS + (attempt * 2000))

    try {
      const res = await fetch(`${METAR_API}?ids=${icaoCode}&format=json`, { signal: controller.signal })
      if (!res.ok) return null
      const data = await res.json()
      if (!data || !data.length) return null
      const metar = data[0]
      const skyCondition = parseSkyCondition(metar.clouds)
      const windDir = metar.wdir ?? null
      const windSpeed = metar.wspd ?? null
      const windGust = metar.wgst ?? null
      const visibility = metar.visib ?? null
      const humidity = metar.humidity ?? null
      return {
        tempC: metar.temp ?? null,
        raw: metar.rawOb ?? null,
        observationTime: metar.reportTime ?? null,
        condition: metar.wxString ?? null,
        skyCondition,
        windDir,
        windSpeed,
        windGust,
        visibility,
        humidity
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      if (aborted && attempt === 0) {
        continue
      }
      return null
    } finally {
      clearTimeout(timeout)
    }
  }
  return null
}

async function fetchForecastModels(lat: number, lon: number, targetDate: string, unit: 'C' | 'F') {
  const tempUnit = unit === 'F' ? 'fahrenheit' : 'celsius'
  const baseUrl = `${OPEN_METEO_API}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&temperature_unit=${tempUnit}&timezone=auto&forecast_days=16&past_days=2`

  const fetchJson = async (url: string, retries = 2): Promise<any> => {
    for (let attempt = 0; attempt < retries; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      try {
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) {
          if (attempt < retries - 1) {
            await new Promise((r) => setTimeout(r, 500))
            continue
          }
          return null
        }
        return await res.json()
      } catch {
        if (attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 500))
          continue
        }
        return null
      } finally {
        clearTimeout(timeout)
      }
    }
    return null
  }

  const pickValue = (data: any) => {
    const times: string[] = data?.daily?.time || []
    const index = times.indexOf(targetDate)
    if (index === -1) return null
    return data?.daily?.temperature_2m_max?.[index] ?? null
  }

  const pickModels = (data: any) => {
    if (!data) return null
    const times: string[] = data?.daily?.time || []
    const index = times.indexOf(targetDate)
    if (index === -1) return null
    const gfsKey = 'temperature_2m_max_gfs_seamless'
    const iconKey = 'temperature_2m_max_icon_seamless'
    const generic = data?.daily?.temperature_2m_max?.[index] ?? null
    const gfs = data?.daily?.[gfsKey]?.[index] ?? generic
    const icon = data?.daily?.[iconKey]?.[index] ?? generic
    if (gfs === null && icon === null) return null
    return { gfs, icon }
  }

  const multi = await fetchJson(`${baseUrl}&models=gfs_seamless,icon_seamless`)
  const multiParsed = pickModels(multi)
  if (multiParsed) return multiParsed

  const [gfsData, iconData] = await Promise.all([
    fetchJson(`${baseUrl}&models=gfs_seamless`),
    fetchJson(`${baseUrl}&models=icon_seamless`)
  ])
  const gfs = pickValue(gfsData)
  const icon = pickValue(iconData)

  if (gfs === null && icon === null) return null
  return { gfs, icon }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Pragma', 'no-cache')

  const cityInput = String(req.query.city || '')
  const date = String(req.query.date || '')
  const unit = (String(req.query.unit || 'F').toUpperCase() === 'C' ? 'C' : 'F') as 'C' | 'F'
  const city = extractCityFromText(cityInput) || cityInput

  if (!cityInput || !date) {
    return res.status(400).json({ error: 'city and date are required' })
  }

  const config = CITY_CONFIG[city]
  if (!config) {
    return res.status(400).json({ error: 'Unknown city' })
  }

  const daysOut = daysBetweenUtc(date)
  if (daysOut > 16 || daysOut < -2) {
    return res.status(200).json({
      weather: {
        currentTemp: null,
        forecastHigh: null,
        condition: null,
        metarRaw: null,
        observationTime: null,
        forecastSource: 'Open-Meteo (auto)',
        forecastStatus: 'unavailable',
        forecastReason: daysOut > 16 ? 'out of range (16-day max)' : 'past range (2-day max)'
      }
    })
  }

  const cacheKey = `${city}-${date}-${unit}`
  const cached = WEATHER_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.status(200).json(cached.data)
  }

  try {
    const [metar, modelData] = await Promise.all([
      config.icaoCode ? fetchMetar(config.icaoCode) : Promise.resolve(null),
      fetchForecastModels(config.geocode.lat, config.geocode.lon, date, unit)
    ])

    const currentTemp = metar?.tempC !== null && metar?.tempC !== undefined
      ? (unit === 'F' ? Math.round((metar.tempC * 9/5 + 32) * 10) / 10 : metar.tempC)
      : null

    const modelForecasts = [
      { model: 'GFS', value: modelData?.gfs ?? null },
      { model: 'ICON', value: modelData?.icon ?? null }
    ]
    const forecastHigh = modelData?.gfs ?? modelData?.icon ?? null

    const payload = {
      weather: {
        currentTemp,
        forecastHigh: forecastHigh ?? null,
        condition: metar?.condition ?? null,
        skyCondition: metar?.skyCondition ?? null,
        windDir: metar?.windDir ?? null,
        windSpeed: metar?.windSpeed ?? null,
        windGust: metar?.windGust ?? null,
        visibility: metar?.visibility ?? null,
        humidity: metar?.humidity ?? null,
        metarRaw: metar?.raw ?? null,
        observationTime: metar?.observationTime ?? null,
        forecastSource: 'Open-Meteo (GFS + ICON)',
        forecastStatus: forecastHigh === null ? 'unavailable' : 'ok',
        forecastReason: forecastHigh === null ? 'no forecast data returned' : null,
        modelForecasts
      }
    }

    WEATHER_CACHE.set(cacheKey, { data: payload, ts: Date.now() })
    return res.status(200).json(payload)
  } catch (error) {
    console.error('weather-detail error', error)
    return res.status(200).json({
      weather: {
        currentTemp: null,
        forecastHigh: null,
        condition: null,
        skyCondition: null,
        windDir: null,
        windSpeed: null,
        windGust: null,
        visibility: null,
        humidity: null,
        metarRaw: null,
        observationTime: null,
        forecastSource: 'Open-Meteo (GFS + ICON)',
        forecastStatus: 'unavailable',
        forecastReason: 'fetch failed',
        modelForecasts: [
          { model: 'GFS', value: null },
          { model: 'ICON', value: null }
        ]
      }
    })
  }
}
