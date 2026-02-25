import type { NextApiRequest, NextApiResponse } from 'next'
import { CITY_CONFIG, extractCityFromText } from '@/lib/weather/stations'

const GAMMA_API = 'https://gamma-api.polymarket.com'
const METAR_API = 'https://aviationweather.gov/api/data/metar'
const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'
const METAR_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.WEATHER_METAR_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.round(parsed) : 8000
})()

type WeatherSnapshot = {
  currentTemp: number | null
  forecastHigh: number | null
  condition: string | null
  metarRaw: string | null
  observationTime: string | null
  forecastSource?: string | null
  forecastStatus?: 'pending' | 'ok' | 'unavailable'
  forecastReason?: string | null
  modelForecasts?: Array<{ model: string; value: number | null }>
}

function extractCity(text: string): string | null {
  return extractCityFromText(text)
}

function extractCityFromTitle(title: string): string | null {
  const patterns = [
    /highest\s+temperature\s+in\s+(.+?)\s+on\s+/i,
    /lowest\s+temperature\s+in\s+(.+?)\s+on\s+/i,
    /temperature\s+in\s+(.+?)\s+on\s+/i,
    /in\s+(.+?)\s+on\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i
  ]

  for (const pattern of patterns) {
    const match = title.match(pattern)
    if (!match?.[1]) continue
    const cleaned = match[1]
      .replace(/,\s*[A-Z]{2}\b/g, '')
      .replace(/\s+\(.*?\)\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (cleaned.length >= 2) return cleaned
  }

  return null
}

function extractTargetTemp(question: string) {
  const rangeMatch = question.match(/(?:between\s+)?(-?\d+)-(-?\d+)°([CF])/i)
  if (rangeMatch) {
    return {
      type: 'range' as const,
      value: parseInt(rangeMatch[1], 10),
      value2: parseInt(rangeMatch[2], 10),
      unit: rangeMatch[3].toUpperCase() as 'C' | 'F'
    }
  }

  const exactMatch = question.match(/(?:be\s+)?(-?\d+)°([CF])\s+on/i)
  if (exactMatch) {
    return {
      type: 'exact' as const,
      value: parseInt(exactMatch[1], 10),
      unit: exactMatch[2].toUpperCase() as 'C' | 'F'
    }
  }

  const aboveMatch = question.match(/(-?\d+)°([CF])\s+or\s+higher/i)
  if (aboveMatch) {
    return {
      type: 'above' as const,
      value: parseInt(aboveMatch[1], 10),
      unit: aboveMatch[2].toUpperCase() as 'C' | 'F'
    }
  }

  const belowMatch = question.match(/(-?\d+)°([CF])\s+or\s+below/i)
  if (belowMatch) {
    return {
      type: 'below' as const,
      value: parseInt(belowMatch[1], 10),
      unit: belowMatch[2].toUpperCase() as 'C' | 'F'
    }
  }

  return null
}

function extractDate(question: string, tz: string) {
  const dateMatch = question.match(/(?:on\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i)
  if (!dateMatch) return null

  const monthName = dateMatch[1]
  const day = parseInt(dateMatch[2], 10)
  const now = new Date()
  const year = now.getFullYear()
  const monthNum = new Date(`${monthName} 1, 2000`).getMonth()
  const dateStr = `${year}-${String(monthNum + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  const nowParts = formatter.formatToParts(now)
  const nowYear = parseInt(nowParts.find(p => p.type === 'year')?.value || '0', 10)
  const nowMonth = parseInt(nowParts.find(p => p.type === 'month')?.value || '0', 10) - 1
  const nowDay = parseInt(nowParts.find(p => p.type === 'day')?.value || '0', 10)
  const nowHour = parseInt(nowParts.find(p => p.type === 'hour')?.value || '0', 10)
  const nowMinute = parseInt(nowParts.find(p => p.type === 'minute')?.value || '0', 10)

  const daysDiff = (new Date(year, monthNum, day).getTime() - new Date(nowYear, nowMonth, nowDay).getTime()) / (1000 * 60 * 60 * 24)
  const hoursToday = 18 - nowHour - (nowMinute / 60)
  const hoursToResolution = (daysDiff * 24) + hoursToday

  if (hoursToResolution < -24) {
    return {
      date: `${year + 1}-${String(monthNum + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      hoursToResolution: Math.round(hoursToResolution + 365 * 24)
    }
  }

  return { date: dateStr, hoursToResolution: Math.max(0, Math.round(hoursToResolution)) }
}

function parseResolutionTime(value: unknown): Date | null {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return new Date(value)
    if (value > 1e9) return new Date(value * 1000)
    return null
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  return null
}

function resolveMarketTime(event: any, market: any) {
  const candidates = [
    event?.resolutionTime,
    event?.resolveTime,
    event?.endDate,
    event?.closeTime,
    event?.closedTime,
    event?.resolutionDate,
    market?.resolutionTime,
    market?.resolveTime,
    market?.endDate,
    market?.closeTime,
    market?.closedTime
  ]

  for (const candidate of candidates) {
    const parsed = parseResolutionTime(candidate)
    if (parsed) return parsed
  }

  return null
}

function getLocalTimeString(tz: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date())
}

function parseMaybeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
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
      return {
        tempC: metar.temp ?? null,
        raw: metar.rawOb ?? null,
        observationTime: metar.reportTime ?? null,
        condition: metar.wxString ?? null
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      if (aborted && attempt === 0) {
        continue
      }
      if (!aborted) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`METAR fetch failed for ${icaoCode}: ${message}`)
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

  const fetchJson = async (url: string) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) return null
      return await res.json()
    } catch (error) {
      console.warn('Forecast fetch failed', error)
      return null
    } finally {
      clearTimeout(timeout)
    }
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

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let index = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }).map(async () => {
    while (index < items.length) {
      const current = index++
      results[current] = await fn(items[current])
    }
  })

  await Promise.all(workers)
  return results
}

const EVENTS_CACHE_TTL_MS = 30 * 1000
const WEATHER_SEARCH_QUERIES = [
  'highest temperature',
  'lowest temperature',
  'weather',
  'climate science',
  'rain',
  'snow',
  'wind speed',
  'hurricane'
]
const CLIMATE_SCIENCE_CATEGORY_ID = '103037'
const WEATHER_KEYWORDS = [
  'weather',
  'temperature',
  'forecast',
  'rain',
  'snow',
  'hurricane',
  'storm',
  'climate',
  'wind',
  'heat',
  'cold'
]
let RAW_EVENTS_CACHE: { events: any[]; ts: number } | null = null
let EVENTS_IN_FLIGHT = false

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function asUnknownArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : [value]
    } catch {
      return [value]
    }
  }
  if (value && typeof value === 'object') return [value]
  return []
}

function getCategoryTokens(event: any) {
  const tokens = new Set<string>()
  const addToken = (value: unknown) => {
    if (value === null || value === undefined) return
    const normalized = normalizeToken(String(value))
    if (normalized) tokens.add(normalized)
  }

  const categoryParts = [
    ...asUnknownArray(event?.category),
    ...asUnknownArray(event?.categories),
    ...asUnknownArray(event?.tags),
    ...asUnknownArray(event?.topicTags)
  ]

  for (const part of categoryParts) {
    if (typeof part === 'string' || typeof part === 'number') {
      addToken(part)
      continue
    }

    if (part && typeof part === 'object') {
      const entry = part as Record<string, unknown>
      addToken(entry.id)
      addToken(entry.slug)
      addToken(entry.label)
      addToken(entry.name)
    }
  }

  return tokens
}

function isWeatherLikeEvent(event: any) {
  const tokens = getCategoryTokens(event)
  if (tokens.has('climate-science') || tokens.has('climate-and-science') || tokens.has(CLIMATE_SCIENCE_CATEGORY_ID)) {
    return true
  }

  const eventText = `${event?.title || ''} ${event?.description || ''} ${event?.slug || ''}`.toLowerCase()
  const marketsText = (event?.markets || []).map((m: any) => m?.question || '').join(' ').toLowerCase()
  return WEATHER_KEYWORDS.some((keyword) => eventText.includes(keyword) || marketsText.includes(keyword))
}

async function fetchSearchEvents(query: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const encoded = encodeURIComponent(query)
    const eventsRes = await fetch(`${GAMMA_API}/public-search?q=${encoded}&limit_per_type=150`, { signal: controller.signal })
    if (!eventsRes.ok) {
      throw new Error('Gamma API failed')
    }
    const searchResult = await eventsRes.json()
    return (searchResult.events || []).filter((e: { closed?: boolean }) => !e.closed)
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchEventsFromGamma() {
  const searchResults = await Promise.allSettled(WEATHER_SEARCH_QUERIES.map(fetchSearchEvents))
  const merged = new Map<string, any>()

  for (const result of searchResults) {
    if (result.status !== 'fulfilled') continue
    for (const event of result.value) {
      if (!isWeatherLikeEvent(event)) continue
      const key = String(event?.id || event?.slug || '')
      if (!key) continue
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, event)
        continue
      }

      const existingTs = Date.parse(existing.updatedAt || existing.createdAt || '')
      const incomingTs = Date.parse(event.updatedAt || event.createdAt || '')
      if (Number.isFinite(incomingTs) && (!Number.isFinite(existingTs) || incomingTs > existingTs)) {
        merged.set(key, event)
      }
    }
  }

  if (!merged.size) {
    throw new Error('Gamma API failed')
  }

  return Array.from(merged.values())
}

function daysBetweenUtc(dateStr: string) {
  const today = new Date()
  const target = new Date(`${dateStr}T00:00:00Z`)
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const diffMs = target.getTime() - utcToday.getTime()
  return diffMs / (1000 * 60 * 60 * 24)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Pragma', 'no-cache')

  try {
    const fast = req.query.fast === '1' || req.query.fast === 'true'
    const now = Date.now()

    if (RAW_EVENTS_CACHE && now - RAW_EVENTS_CACHE.ts >= EVENTS_CACHE_TTL_MS && !EVENTS_IN_FLIGHT) {
      EVENTS_IN_FLIGHT = true
      fetchEventsFromGamma()
        .then((events) => {
          RAW_EVENTS_CACHE = { events, ts: Date.now() }
        })
        .catch(() => {})
        .finally(() => {
          EVENTS_IN_FLIGHT = false
        })
    }

    let events: any[] = []
    try {
      events = RAW_EVENTS_CACHE && now - RAW_EVENTS_CACHE.ts < EVENTS_CACHE_TTL_MS
        ? RAW_EVENTS_CACHE.events
        : await fetchEventsFromGamma()
    } catch {
      if (RAW_EVENTS_CACHE) {
        events = RAW_EVENTS_CACHE.events
      } else {
        events = []
      }
    }

    if (events.length && (!RAW_EVENTS_CACHE || now - RAW_EVENTS_CACHE.ts >= EVENTS_CACHE_TTL_MS)) {
      RAW_EVENTS_CACHE = { events, ts: Date.now() }
    }

    const weatherCache = new Map<string, WeatherSnapshot>()

    const buildEvent = async (event: any) => {
      try {
        const cityFromTitle = extractCityFromTitle(event.title || '')
        const city = extractCity(`${event.title || ''} ${event.description || ''}`)
          || extractCity(cityFromTitle || '')
          || cityFromTitle
        if (!city) return null

        const config = CITY_CONFIG[city]
        if (!config) return null
        const tz = config.tz

        const dateInfo = extractDate(event.title || '', tz)
        if (!dateInfo) return null

        const marketList = Array.isArray(event.markets) ? event.markets : []
        const unitMatch = (event.title || '').match(/°([CF])/i)
          || marketList.map((m: any) => (m?.question || '').match(/°([CF])/i)).find(Boolean)
        const unit = (unitMatch?.[1]?.toUpperCase() === 'C' ? 'C' : 'F') as 'C' | 'F'

        const cacheKey = `${city}-${dateInfo.date}-${unit}`
        let weather = weatherCache.get(cacheKey)

        if (!weather) {
          if (fast) {
            const daysOut = daysBetweenUtc(dateInfo.date)
            weather = {
              currentTemp: null,
              forecastHigh: null,
              condition: null,
              metarRaw: null,
              observationTime: null,
              forecastSource: 'Open-Meteo (GFS + ICON)',
              forecastStatus: daysOut > 16 || daysOut < -2 ? 'unavailable' : 'pending',
              forecastReason: daysOut > 16
                ? 'out of range (16-day max)'
                : daysOut < -2
                  ? 'past range (2-day max)'
                  : null
            }
          } else {
            const [metar, modelData] = await Promise.all([
              config?.icaoCode ? fetchMetar(config.icaoCode) : Promise.resolve(null),
              config?.geocode
                ? fetchForecastModels(config.geocode.lat, config.geocode.lon, dateInfo.date, unit)
                : Promise.resolve(null)
            ])

            const currentTemp = metar?.tempC !== null && metar?.tempC !== undefined
              ? (unit === 'F' ? Math.round((metar.tempC * 9/5 + 32) * 10) / 10 : metar.tempC)
              : null

            const modelForecasts = [
              { model: 'GFS', value: modelData?.gfs ?? null },
              { model: 'ICON', value: modelData?.icon ?? null }
            ]
            const forecastHigh = modelData?.gfs ?? modelData?.icon ?? null

            weather = {
              currentTemp,
              forecastHigh: forecastHigh ?? null,
              condition: metar?.condition ?? null,
              metarRaw: metar?.raw ?? null,
              observationTime: metar?.observationTime ?? null,
              forecastSource: 'Open-Meteo (GFS + ICON)',
              forecastStatus: config?.geocode
                ? (forecastHigh === null ? 'unavailable' : 'ok')
                : 'unavailable',
              forecastReason: config?.geocode
                ? (forecastHigh === null ? 'no forecast data returned' : null)
                : 'missing geocode for city',
              modelForecasts: config?.geocode ? modelForecasts : undefined
            }
          }

          weatherCache.set(cacheKey, weather)
        }

        if (!weather) return null

        const outcomes = marketList.map((market: any) => {
          const outcomeNames = parseMaybeArray(market.outcomes)
          const tokenIds = parseMaybeArray(market.clobTokenIds)
          const outcomePrices = parseMaybeArray(market.outcomePrices).map(p => parseFloat(p))

          const yesIndex = outcomeNames.findIndex((o) => o.toLowerCase() === 'yes')
          const noIndex = outcomeNames.findIndex((o) => o.toLowerCase() === 'no')

          const yesTokenId = tokenIds[yesIndex] || ''
          const noTokenId = tokenIds[noIndex] || ''

          const yesPrice = yesIndex >= 0 ? outcomePrices[yesIndex] ?? null : null
          const noPrice = noIndex >= 0 ? outcomePrices[noIndex] ?? null : null

          const volumeNum = Number(market.volumeNum ?? market.volume ?? 0)
          const liquidityNum = Number(market.liquidityNum ?? market.liquidity ?? 0)

          return {
            marketId: String(market.id || ''),
            conditionId: String(market.conditionId || market.condition_id || ''),
            question: market.question || '',
            yesTokenId,
            noTokenId,
            yesPrice,
            noPrice,
            volume: Number.isFinite(volumeNum) ? volumeNum : 0,
            liquidity: Number.isFinite(liquidityNum) ? liquidityNum : 0,
            target: extractTargetTemp(market.question || '')
          }
        }).filter((o: any) => o.yesTokenId && o.noTokenId)

        const resolutionAt = resolveMarketTime(event, marketList[0])
        const hoursToResolution = resolutionAt
          ? Math.max(0, Math.round((resolutionAt.getTime() - Date.now()) / (1000 * 60 * 60)))
          : dateInfo.hoursToResolution

        return {
          eventId: String(event.id || ''),
          title: event.title || '',
          city,
          targetDate: dateInfo.date,
          unit,
          hoursToResolution,
          localTime: getLocalTimeString(tz),
          localDate: new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'medium' }).format(new Date()),
          slug: event.slug || '',
          weather,
          outcomes
        }
      } catch (error) {
        console.warn('weather-hub skipped malformed event', event?.id, error)
        return null
      }
    }

    const results = await mapWithLimit(events, 5, buildEvent)
    const output = results.filter(Boolean)

    return res.status(200).json({
      events: output,
      fetchedAt: new Date().toISOString()
    })
  } catch (error) {
    console.error('weather-hub error', error)
    return res.status(500).json({ error: 'Failed to build weather hub' })
  }
}
