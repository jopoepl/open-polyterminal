import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const GAMMA_API = 'https://gamma-api.polymarket.com'
const CLOB_API = 'https://clob.polymarket.com'
const DATA_API = 'https://data-api.polymarket.com'
const METAR_API = 'https://aviationweather.gov/api/data/metar'
const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const STATIONS_PATH = path.join(REPO_ROOT, 'src', 'data', 'weather-stations.json')

let rawStations = []

try {
  rawStations = JSON.parse(readFileSync(STATIONS_PATH, 'utf8'))
} catch {
  rawStations = []
}

const stations = Array.isArray(rawStations) ? rawStations : []
const stationByCity = new Map(stations.map((station) => [String(station.city || '').toLowerCase(), station]))
const aliasRows = stations
  .flatMap((station) => {
    const city = String(station.city || '').trim()
    const aliases = Array.isArray(station.aliases) ? station.aliases : []
    const names = new Set([city, ...aliases].map((name) => String(name).trim().toLowerCase()).filter(Boolean))
    return Array.from(names).map((alias) => ({ alias, city }))
  })
  .sort((a, b) => b.alias.length - a.alias.length)

export const MCP_SERVER_INFO = {
  name: 'polyterminal-weather-mcp',
  version: '0.2.0'
}

function parseCityFromText(text) {
  const lower = String(text || '').toLowerCase()
  if (!lower) return null

  for (const row of aliasRows) {
    if (lower.includes(row.alias)) return row.city
  }

  return null
}

function parseCityFromEventTitle(title) {
  const value = String(title || '')
  const patterns = [
    /highest\s+temperature\s+in\s+(.+?)\s+on\s+/i,
    /lowest\s+temperature\s+in\s+(.+?)\s+on\s+/i,
    /temperature\s+in\s+(.+?)\s+on\s+/i,
    /in\s+(.+?)\s+on\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i
  ]

  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (!match || !match[1]) continue
    const cleaned = match[1]
      .replace(/,\s*[A-Z]{2}\b/g, '')
      .replace(/\s+\(.*?\)\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (cleaned) return cleaned
  }

  return null
}

function resolveStation({ city, eventTitle, icaoCode }) {
  const directCode = String(icaoCode || '').trim().toUpperCase()
  if (directCode) {
    const byCode = stations.find((station) => String(station.icaoCode || '').toUpperCase() === directCode) || null
    if (byCode) return byCode
    return {
      city: city || 'unknown',
      icaoCode: directCode,
      geocode: null,
      tz: null
    }
  }

  const cityHint = String(city || '').trim()
  const normalizedHint = cityHint.toLowerCase()
  if (normalizedHint && stationByCity.has(normalizedHint)) {
    return stationByCity.get(normalizedHint)
  }

  if (cityHint) {
    const parsed = parseCityFromText(cityHint)
    if (parsed) {
      const station = stationByCity.get(parsed.toLowerCase())
      if (station) return station
    }
  }

  const titleCity = parseCityFromEventTitle(eventTitle)
  if (titleCity) {
    const parsed = parseCityFromText(titleCity)
    if (parsed) {
      const station = stationByCity.get(parsed.toLowerCase())
      if (station) return station
    }
  }

  const fromTitle = parseCityFromText(eventTitle)
  if (fromTitle) {
    const station = stationByCity.get(fromTitle.toLowerCase())
    if (station) return station
  }

  return null
}

function buildUrl(base, query) {
  const url = new URL(base)
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    const text = await response.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url,
      json,
      text: json ? undefined : text
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error instanceof Error ? error.message : 'request failed',
      url,
      json: null
    }
  } finally {
    clearTimeout(timeout)
  }
}

function textResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ]
  }
}

function ensureNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function callTool(name, args) {
  if (name === 'list_weather_stations') {
    return textResult({
      stationCount: stations.length,
      stations: stations.map((station) => ({
        city: station.city,
        icaoCode: station.icaoCode,
        tz: station.tz,
        geocode: station.geocode
      })),
      source: STATIONS_PATH
    })
  }

  if (name === 'resolve_weather_station') {
    const station = resolveStation(args || {})
    if (!station) {
      return textResult({
        found: false,
        message: 'No matching weather station was found.',
        source: STATIONS_PATH
      })
    }

    return textResult({
      found: true,
      station: {
        city: station.city,
        icaoCode: station.icaoCode,
        tz: station.tz,
        geocode: station.geocode
      },
      source: station.resolutionSource || STATIONS_PATH
    })
  }

  if (name === 'get_metar_observation') {
    const station = resolveStation(args || {})
    const icaoCode = String(args?.icaoCode || station?.icaoCode || '').trim().toUpperCase()

    if (!icaoCode) {
      return textResult({
        ok: false,
        error: 'Missing icaoCode/city/eventTitle; unable to resolve METAR station.'
      })
    }

    const hours = Math.max(1, Math.min(96, Math.round(ensureNumber(args?.hours, 3))))
    const url = buildUrl(METAR_API, { ids: icaoCode, format: 'json', hours })
    const response = await fetchJson(url)
    const rows = Array.isArray(response.json) ? response.json : []
    const latest = rows[0] || null

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      station: station
        ? {
            city: station.city,
            icaoCode: station.icaoCode,
            tz: station.tz,
            geocode: station.geocode
          }
        : { icaoCode },
      observation: latest
        ? {
            reportTime: latest.reportTime || null,
            tempC: latest.temp ?? null,
            dewpointC: latest.dewp ?? null,
            windDir: latest.wdir ?? null,
            windSpeedKt: latest.wspd ?? null,
            windGustKt: latest.wgst ?? null,
            visibilityM: latest.visib ?? null,
            altimeter: latest.altim ?? null,
            weather: latest.wxString || null,
            cloudLayers: latest.clouds || [],
            raw: latest.rawOb || null
          }
        : null,
      rawCount: rows.length
    })
  }

  if (name === 'get_open_meteo_forecast') {
    const station = resolveStation(args || {})
    const latitude = args?.latitude ?? station?.geocode?.lat
    const longitude = args?.longitude ?? station?.geocode?.lon

    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return textResult({
        ok: false,
        error: 'Missing latitude/longitude and no city station geocode was resolved.'
      })
    }

    const temperatureUnit = String(args?.temperatureUnit || 'celsius').toLowerCase() === 'fahrenheit'
      ? 'fahrenheit'
      : 'celsius'
    const forecastDays = Math.max(1, Math.min(16, Math.round(ensureNumber(args?.forecastDays, 7))))
    const timezone = String(args?.timezone || station?.tz || 'auto')
    const models = String(args?.models || 'gfs_seamless,icon_seamless')

    const url = buildUrl(OPEN_METEO_API, {
      latitude,
      longitude,
      timezone,
      temperature_unit: temperatureUnit,
      forecast_days: forecastDays,
      models,
      hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,wind_gusts_10m,cloud_cover,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset'
    })

    const response = await fetchJson(url)
    const json = response.json || {}

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      station: station
        ? {
            city: station.city,
            icaoCode: station.icaoCode,
            tz: station.tz,
            geocode: station.geocode
          }
        : null,
      timezone: json.timezone || null,
      timezoneAbbreviation: json.timezone_abbreviation || null,
      hourlyUnits: json.hourly_units || null,
      dailyUnits: json.daily_units || null,
      hourly: json.hourly || null,
      daily: json.daily || null
    })
  }

  if (name === 'get_polymarket_weather_events') {
    const query = String(args?.query || 'highest temperature')
    const limit = Math.max(1, Math.min(200, Math.round(ensureNumber(args?.limit, 80))))
    const url = buildUrl(`${GAMMA_API}/public-search`, {
      q: query,
      limit_per_type: limit
    })
    const response = await fetchJson(url)
    const events = Array.isArray(response.json?.events) ? response.json.events : []

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      count: events.length,
      events: events.map((event) => ({
        id: event?.id || null,
        slug: event?.slug || null,
        title: event?.title || null,
        active: event?.active ?? null,
        closed: event?.closed ?? null
      }))
    })
  }

  if (name === 'get_polymarket_event') {
    const eventId = String(args?.eventId || '').trim()
    const slug = String(args?.slug || '').trim()
    const url = eventId
      ? buildUrl(`${GAMMA_API}/events`, { id: eventId })
      : slug
      ? buildUrl(`${GAMMA_API}/events`, { slug })
      : null

    if (!url) {
      return textResult({
        ok: false,
        error: 'Provide eventId or slug.'
      })
    }

    const response = await fetchJson(url)
    const event = Array.isArray(response.json) ? response.json[0] : null

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      event: event || null
    })
  }

  if (name === 'get_polymarket_trades') {
    const url = buildUrl(`${DATA_API}/trades`, {
      asset_id: args?.assetId,
      market: args?.market,
      user: args?.user,
      side: args?.side,
      limit: Math.max(1, Math.min(500, Math.round(ensureNumber(args?.limit, 100)))),
      offset: Math.max(0, Math.round(ensureNumber(args?.offset, 0)))
    })

    const response = await fetchJson(url)
    const trades = Array.isArray(response.json) ? response.json : Array.isArray(response.json?.trades) ? response.json.trades : []

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      tradeCount: trades.length,
      trades
    })
  }

  if (name === 'get_polymarket_positions') {
    const user = String(args?.user || '').trim()
    if (!user) {
      return textResult({
        ok: false,
        error: 'user is required for positions.'
      })
    }

    const url = buildUrl(`${DATA_API}/positions`, {
      user,
      market: args?.market,
      redeemable: args?.redeemable,
      sizeThreshold: args?.sizeThreshold,
      limit: Math.max(1, Math.min(500, Math.round(ensureNumber(args?.limit, 200)))),
      offset: Math.max(0, Math.round(ensureNumber(args?.offset, 0)))
    })

    const response = await fetchJson(url)
    const positions = Array.isArray(response.json) ? response.json : Array.isArray(response.json?.positions) ? response.json.positions : []

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      positionCount: positions.length,
      positions
    })
  }

  if (name === 'get_clob_orderbook') {
    const tokenId = String(args?.tokenId || '').trim()
    if (!tokenId) {
      return textResult({
        ok: false,
        error: 'tokenId is required.'
      })
    }

    const url = buildUrl(`${CLOB_API}/book`, { token_id: tokenId })
    const response = await fetchJson(url)
    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      book: response.json || null
    })
  }

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Unknown tool: ${name}`
      }
    ]
  }
}

export const MCP_TOOLS = [
  {
    name: 'list_weather_stations',
    description: 'List supported weather market stations (city -> ICAO -> geocode/timezone).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: 'resolve_weather_station',
    description: 'Resolve the correct weather station from city text, event title, or ICAO code.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        city: { type: 'string' },
        eventTitle: { type: 'string' },
        icaoCode: { type: 'string' }
      }
    }
  },
  {
    name: 'get_metar_observation',
    description: 'Fetch latest METAR observations from AviationWeather for a resolved station.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        city: { type: 'string' },
        eventTitle: { type: 'string' },
        icaoCode: { type: 'string' },
        hours: { type: 'number' }
      }
    }
  },
  {
    name: 'get_open_meteo_forecast',
    description: 'Fetch Open-Meteo forecast context (hourly + daily) using city/station or lat/lon.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        city: { type: 'string' },
        eventTitle: { type: 'string' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        timezone: { type: 'string' },
        temperatureUnit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
        models: { type: 'string' },
        forecastDays: { type: 'number' }
      }
    }
  },
  {
    name: 'get_polymarket_weather_events',
    description: 'Search weather markets/events from Gamma public-search.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'get_polymarket_event',
    description: 'Fetch a specific Polymarket event from Gamma by id or slug.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        eventId: { type: 'string' },
        slug: { type: 'string' }
      }
    }
  },
  {
    name: 'get_polymarket_trades',
    description: 'Fetch recent trades from Polymarket Data API.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        assetId: { type: 'string' },
        market: { type: 'string' },
        user: { type: 'string' },
        side: { type: 'string' },
        limit: { type: 'number' },
        offset: { type: 'number' }
      }
    }
  },
  {
    name: 'get_polymarket_positions',
    description: 'Fetch user positions from Polymarket Data API.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['user'],
      properties: {
        user: { type: 'string' },
        market: { type: 'string' },
        redeemable: { type: 'boolean' },
        sizeThreshold: { type: 'number' },
        limit: { type: 'number' },
        offset: { type: 'number' }
      }
    }
  },
  {
    name: 'get_clob_orderbook',
    description: 'Fetch live top-of-book and depth for a Polymarket token_id from CLOB.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tokenId'],
      properties: {
        tokenId: { type: 'string' }
      }
    }
  }
]

function result(id, payload) {
  return {
    jsonrpc: '2.0',
    id,
    result: payload
  }
}

function error(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  }
}

export async function handleMcpMessage(message) {
  const { id, method, params } = message || {}

  if (method === 'initialize') {
    return result(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: MCP_SERVER_INFO
    })
  }

  if (method === 'notifications/initialized') {
    return null
  }

  if (method === 'ping') {
    return result(id, {})
  }

  if (method === 'tools/list') {
    return result(id, { tools: MCP_TOOLS })
  }

  if (method === 'tools/call') {
    try {
      const toolResult = await callTool(params?.name, params?.arguments || {})
      return result(id, toolResult)
    } catch (toolError) {
      return result(id, {
        isError: true,
        content: [
          {
            type: 'text',
            text: toolError instanceof Error ? toolError.message : 'Tool execution failed'
          }
        ]
      })
    }
  }

  if (id !== undefined && id !== null) {
    return error(id, -32601, `Method not found: ${method}`)
  }

  return null
}
