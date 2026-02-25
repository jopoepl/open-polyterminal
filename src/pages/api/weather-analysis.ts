import type { NextApiRequest, NextApiResponse } from 'next'
import { CITY_CONFIG, extractCityFromText, getStationRecordByCity } from '@/lib/weather/stations'
import { parseIowaMetar, type DecodedMetar } from '@/lib/weather/metar-decoder'

// Model name to Open-Meteo model ID mapping
// These are global models available on the main forecast API
const OPEN_METEO_MODELS: Record<string, string> = {
  'GFS': 'gfs_seamless',
  'ICON': 'icon_seamless',
  'GEM': 'gem_seamless',
  'JMA': 'jma_seamless',
  'UKMO': 'ukmo_seamless',
  'ARPEGE': 'arpege_seamless',
}

// Model name to metadata API endpoint ID mapping
// These are the actual model IDs used in the metadata API
const MODEL_METADATA_IDS: Record<string, string> = {
  'GFS': 'ncep_gfs025',
  'ICON': 'dwd_icon',
  'GEM': 'cmc_gem_gdps',
  'JMA': 'jma_gsm',
  'UKMO': 'ukmo_global_deterministic_10km',
  'ARPEGE': 'meteofrance_arpege_world025',
  'ECMWF': 'ecmwf_ifs025',
}

// ECMWF has its own dedicated API endpoint
const ECMWF_API = 'https://api.open-meteo.com/v1/ecmwf'

function getModelsForLocation(_lat: number, _lon: number): Record<string, string> {
  // For now, use the same global models everywhere
  // US regional models (HRRR, NAM, NBM) require separate API endpoints
  return { ...OPEN_METEO_MODELS }
}

// Model run times (UTC hours when models typically initialize)
const MODEL_RUN_TIMES: Record<string, { runs: number[] | 'hourly'; delayHours: number }> = {
  'GFS': { runs: [0, 6, 12, 18], delayHours: 4 },
  'HRRR': { runs: 'hourly', delayHours: 1 },
  'NAM': { runs: [0, 6, 12, 18], delayHours: 2 },
  'GEFS': { runs: [0, 6, 12, 18], delayHours: 5 },
  'NBM': { runs: [1, 7, 13, 19], delayHours: 2 },
  'ECMWF': { runs: [0, 6, 12, 18], delayHours: 6 },
  'ICON': { runs: [0, 6, 12, 18], delayHours: 3 },
  'ARPEGE': { runs: [0, 6, 12, 18], delayHours: 3 },
  'UKMO': { runs: [0, 6, 12, 18], delayHours: 5 },
  'GEM': { runs: [0, 12], delayHours: 4 },
  'JMA': { runs: [0, 6, 12, 18], delayHours: 5 },
}

const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'
const PREVIOUS_RUNS_API = 'https://previous-runs-api.open-meteo.com/v1/forecast'
const IOWA_MESONET_API = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py'
const AVIATION_WEATHER_API = 'https://aviationweather.gov/api/data/metar'

const WEATHER_CACHE = new Map<string, { data: any; ts: number }>()
const CACHE_TTL_MS = 60 * 1000

// Response types
interface StationInfo {
  city: string
  icaoCode: string
  timezone: string
  localTime: string
  coordinates: { lat: number; lon: number }
}

interface TargetInfo {
  date: string
  marketBucket: { low: number; high: number } | null
  unit: 'C' | 'F'
  hoursToResolution: number
}

interface HighLowData {
  observedHigh: number | null
  observedLow: number | null
  forecastHigh: Array<{ model: string; value: number }>
  forecastLow: Array<{ model: string; value: number }>
  consensus: { high: number; low: number } | null
}

interface ModelData {
  name: string
  runTime: string
  hourlyTemps: Array<{ time: string; temp: number }>
  dailyHigh: number | null
  dailyLow: number | null
}

interface ForecastEvolutionData {
  model: string
  runs: Array<{
    runDate: string
    predictedHigh: number
    predictedLow: number
  }>
  trend: 'warming' | 'cooling' | 'stable'
}

interface BiasData {
  current: 'warm' | 'cold' | 'neutral'
  deviation: number
}

interface ModelUpdateInfo {
  model: string
  lastRun: string
  nextRun: string
  nextRunAt?: string
  minutesUntilNext: number
  dataAgeMinutes?: number
}

interface MetarInfo {
  lastUpdate: string
  nextUpdateIn: number
  updateInterval: number
}

// Hourly forecast detail for short-term forecasts
export interface HourlyForecastPoint {
  time: string
  temp: number
  feelsLike: number
  precipProbability: number
  precipAmount: number
  weatherCode: number
  weatherDescription: string
  cloudCover: number
  windSpeed: number
  windDirection: number
  windGusts: number
  humidity: number
}

export interface WeatherAnalysisResponse {
  station: StationInfo
  target: TargetInfo
  highLow: HighLowData
  models: ModelData[]
  forecastEvolution: ForecastEvolutionData[]
  observations: DecodedMetar[]
  metar: MetarInfo
  bias: BiasData
  modelUpdates: ModelUpdateInfo[]
  hourlyForecast: HourlyForecastPoint[]
}

async function fetchWithTimeout(url: string, timeoutMs: number = 10000): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchText(url: string, timeoutMs: number = 10000): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim())
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',')
    const row: Record<string, string> = {}
    headers.forEach((header, idx) => {
      row[header] = values[idx]?.trim() || ''
    })
    rows.push(row)
  }

  return rows
}

// Primary METAR source - aviationweather.gov (fast, real-time)
async function fetchAviationWeatherMetar(icaoCode: string, date: string, unit: 'C' | 'F', timezone: string): Promise<DecodedMetar[]> {
  // Fetch last 48 hours of METAR data to ensure we have full day coverage
  const url = `${AVIATION_WEATHER_API}?ids=${icaoCode}&hours=48&format=json`
  const data = await fetchWithTimeout(url, 10000)

  if (!data || !Array.isArray(data) || data.length === 0) return []

  // Calculate the local date boundaries in UTC
  // For the target date in local timezone, find the UTC range
  const targetDateStart = new Date(`${date}T00:00:00`)
  const targetDateEnd = new Date(`${date}T23:59:59`)

  // Get UTC offset for this timezone on the target date
  // We'll check if each observation falls within the local day
  const isWithinLocalDay = (utcTimeStr: string): boolean => {
    const utcTime = new Date(utcTimeStr)
    // Format the UTC time in the target timezone and check if it matches the target date
    const localDateStr = utcTime.toLocaleDateString('en-CA', { timeZone: timezone }) // en-CA gives YYYY-MM-DD format
    return localDateStr === date
  }

  const observations: DecodedMetar[] = []

  for (const metar of data) {
    try {
      // Filter to target date in LOCAL timezone
      const reportTime = metar.reportTime || ''
      if (!reportTime || !isWithinLocalDay(reportTime)) continue

      // Parse temperature (aviationweather returns Celsius)
      const tempC = typeof metar.temp === 'number' ? metar.temp : null
      const dewPointC = typeof metar.dewp === 'number' ? metar.dewp : null

      const temp = tempC !== null
        ? (unit === 'F' ? Math.round((tempC * 9/5 + 32) * 10) / 10 : tempC)
        : null

      const dewPoint = dewPointC !== null
        ? (unit === 'F' ? Math.round((dewPointC * 9/5 + 32) * 10) / 10 : dewPointC)
        : null

      // Parse wind
      const windDir = typeof metar.wdir === 'number' ? metar.wdir : null
      const windSpeed = typeof metar.wspd === 'number' ? metar.wspd : null
      const windGust = typeof metar.wgst === 'number' ? metar.wgst : null

      // Parse visibility
      let visibility: number | null = null
      if (typeof metar.visib === 'number') {
        visibility = metar.visib
      } else if (metar.visib === '6+') {
        visibility = 10 // 6+ statute miles, treat as 10+
      }

      // Parse clouds
      const skyLayers: Array<{ cover: string; altitude: number | null; decoded: string }> = []
      if (Array.isArray(metar.clouds)) {
        for (const cloud of metar.clouds) {
          const cover = cloud.cover || ''
          const base = typeof cloud.base === 'number' ? Math.round(cloud.base / 100) : null
          skyLayers.push({
            cover,
            altitude: base,
            decoded: base !== null ? `${SKY_COVER_DECODE[cover] || cover} at ${(base * 100).toLocaleString()}ft` : SKY_COVER_DECODE[cover] || cover
          })
        }
      }

      // Determine sky condition from highest coverage
      let skyCondition = 'Clear'
      if (skyLayers.length > 0) {
        const coverOrder = ['CLR', 'SKC', 'NSC', 'NCD', 'FEW', 'SCT', 'BKN', 'OVC', 'VV']
        let highestCover = skyLayers[0]
        for (const layer of skyLayers) {
          if (coverOrder.indexOf(layer.cover) > coverOrder.indexOf(highestCover.cover)) {
            highestCover = layer
          }
        }
        skyCondition = highestCover.decoded
      }

      // Parse weather phenomena
      const weather = metar.wxString || null

      // Pressure (already in hPa)
      const pressure = typeof metar.altim === 'number' ? metar.altim : null

      // Calculate humidity
      const humidity = (tempC !== null && dewPointC !== null)
        ? Math.round(100 * Math.exp((17.27 * dewPointC) / (237.7 + dewPointC) - (17.27 * tempC) / (237.7 + tempC)))
        : null

      // Wind direction to cardinal
      const cardinalDirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
      const dirCardinal = windDir !== null ? cardinalDirs[Math.round(windDir / 22.5) % 16] : null

      observations.push({
        time: reportTime,
        temp,
        tempUnit: unit,
        dewPoint,
        wind: {
          direction: windDir,
          directionCardinal: dirCardinal,
          speed: windSpeed,
          gust: windGust,
          unit: 'kt'
        },
        visibility,
        visibilityUnit: 'mi',
        skyCondition,
        skyLayers,
        weather,
        pressure,
        pressureUnit: 'hPa',
        humidity,
        raw: metar.rawOb || ''
      })
    } catch {
      // Skip malformed entries
    }
  }

  // Sort by time descending (most recent first)
  observations.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())

  return observations
}

const SKY_COVER_DECODE: Record<string, string> = {
  CLR: 'Clear',
  SKC: 'Clear',
  NSC: 'No significant clouds',
  NCD: 'No clouds detected',
  FEW: 'Few clouds',
  SCT: 'Scattered clouds',
  BKN: 'Broken clouds',
  OVC: 'Overcast',
  VV: 'Vertical visibility'
}

// Fallback METAR source - Iowa Mesonet (slower but reliable)
async function fetchIowaMetar(icaoCode: string, date: string, unit: 'C' | 'F'): Promise<DecodedMetar[]> {
  const [year, month, day] = date.split('-')

  // Fetch from Iowa Mesonet
  const params = new URLSearchParams({
    station: icaoCode,
    data: 'all',
    year1: year,
    month1: month,
    day1: day,
    year2: year,
    month2: month,
    day2: day,
    tz: 'Etc/UTC',
    format: 'onlycomma',
    latlon: 'no',
    elev: 'no',
    direct: 'no',
    report_type: '3'
  })

  const url = `${IOWA_MESONET_API}?${params.toString()}`
  const csv = await fetchText(url, 15000)

  if (!csv) return []

  const rows = parseCSV(csv)
  const observations: DecodedMetar[] = []

  for (const row of rows) {
    try {
      const decoded = parseIowaMetar(row as any, unit)
      if (decoded.time) {
        observations.push(decoded)
      }
    } catch {
      // Skip malformed rows
    }
  }

  // Sort by time descending (most recent first)
  observations.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())

  return observations
}

async function fetchECMWF(
  lat: number,
  lon: number,
  targetDate: string,
  unit: 'C' | 'F'
): Promise<ModelData | null> {
  const tempUnit = unit === 'F' ? 'fahrenheit' : 'celsius'

  const url = `${ECMWF_API}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=${tempUnit}&timezone=auto&forecast_days=7`

  const data = await fetchWithTimeout(url, 10000)
  if (!data) return null

  const hourlyTimes: string[] = data.hourly?.time || []
  const hourlyTemps: number[] = data.hourly?.temperature_2m || []

  // Filter to target date
  const targetDayTemps: Array<{ time: string; temp: number }> = []
  for (let i = 0; i < hourlyTimes.length; i++) {
    if (hourlyTimes[i]?.startsWith(targetDate) && hourlyTemps[i] !== null) {
      targetDayTemps.push({ time: hourlyTimes[i], temp: hourlyTemps[i] })
    }
  }

  // Get daily high/low for target date
  const dailyTimes: string[] = data.daily?.time || []
  const dailyHighs: number[] = data.daily?.temperature_2m_max || []
  const dailyLows: number[] = data.daily?.temperature_2m_min || []

  const dateIndex = dailyTimes.indexOf(targetDate)
  const dailyHigh = dateIndex >= 0 ? dailyHighs[dateIndex] : null
  const dailyLow = dateIndex >= 0 ? dailyLows[dateIndex] : null

  // Get last model run time for ECMWF
  const runSchedule = MODEL_RUN_TIMES['ECMWF']
  let runTime = '00Z'
  if (runSchedule && runSchedule.runs !== 'hourly') {
    const now = new Date()
    const currentHour = now.getUTCHours()
    const availableHour = currentHour - runSchedule.delayHours
    let lastRun = runSchedule.runs[0]
    for (const run of runSchedule.runs) {
      if (run <= availableHour) {
        lastRun = run
      }
    }
    runTime = `${String(lastRun).padStart(2, '0')}Z`
  }

  if (targetDayTemps.length > 0 || dailyHigh !== null) {
    return {
      name: 'ECMWF',
      runTime,
      hourlyTemps: targetDayTemps,
      dailyHigh,
      dailyLow
    }
  }

  return null
}

// WMO Weather code to human-readable description
function getWeatherDescription(code: number): string {
  const descriptions: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  }
  return descriptions[code] || 'Unknown'
}

// Fetch detailed hourly forecast for the target market date
async function fetchHourlyForecast(
  lat: number,
  lon: number,
  targetDate: string,
  unit: 'C' | 'F'
): Promise<HourlyForecastPoint[]> {
  const tempUnit = unit === 'F' ? 'fahrenheit' : 'celsius'
  const windUnit = 'kn' // knots

  // Fetch up to 7 days to cover future markets
  const url = `${OPEN_METEO_API}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}&timezone=auto&forecast_days=7`

  const data = await fetchWithTimeout(url, 10000)
  if (!data) return []

  const times: string[] = data.hourly?.time || []
  const temps: number[] = data.hourly?.temperature_2m || []
  const feelsLike: number[] = data.hourly?.apparent_temperature || []
  const precipProb: number[] = data.hourly?.precipitation_probability || []
  const precipAmount: number[] = data.hourly?.precipitation || []
  const weatherCodes: number[] = data.hourly?.weather_code || []
  const cloudCover: number[] = data.hourly?.cloud_cover || []
  const windSpeed: number[] = data.hourly?.wind_speed_10m || []
  const windDir: number[] = data.hourly?.wind_direction_10m || []
  const windGusts: number[] = data.hourly?.wind_gusts_10m || []
  const humidity: number[] = data.hourly?.relative_humidity_2m || []

  const forecast: HourlyForecastPoint[] = []

  for (let i = 0; i < times.length; i++) {
    // Only include hours for the target date
    if (times[i]?.startsWith(targetDate)) {
      forecast.push({
        time: times[i],
        temp: temps[i] ?? 0,
        feelsLike: feelsLike[i] ?? temps[i] ?? 0,
        precipProbability: precipProb[i] ?? 0,
        precipAmount: precipAmount[i] ?? 0,
        weatherCode: weatherCodes[i] ?? 0,
        weatherDescription: getWeatherDescription(weatherCodes[i] ?? 0),
        cloudCover: cloudCover[i] ?? 0,
        windSpeed: Math.round(windSpeed[i] ?? 0),
        windDirection: windDir[i] ?? 0,
        windGusts: Math.round(windGusts[i] ?? 0),
        humidity: humidity[i] ?? 0,
      })
    }
  }

  return forecast
}

async function fetchMultiModelForecasts(
  lat: number,
  lon: number,
  targetDate: string,
  unit: 'C' | 'F'
): Promise<ModelData[]> {
  const tempUnit = unit === 'F' ? 'fahrenheit' : 'celsius'

  // Get location-appropriate models
  const locationModels = getModelsForLocation(lat, lon)
  const modelIds = Object.values(locationModels).join(',')

  // Fetch hourly data for multi-model comparison
  const hourlyUrl = `${OPEN_METEO_API}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=${tempUnit}&timezone=auto&forecast_days=7&past_days=1&models=${modelIds}`

  const data = await fetchWithTimeout(hourlyUrl, 15000)
  if (!data) return []

  const models: ModelData[] = []

  // Process each model
  for (const [modelName, modelId] of Object.entries(locationModels)) {
    const hourlyKey = `temperature_2m_${modelId}`
    const dailyHighKey = `temperature_2m_max_${modelId}`
    const dailyLowKey = `temperature_2m_min_${modelId}`

    // Get hourly temps
    const hourlyTimes: string[] = data.hourly?.time || []
    const hourlyTemps: number[] = data.hourly?.[hourlyKey] || data.hourly?.temperature_2m || []

    // Filter to target date
    const targetDayTemps: Array<{ time: string; temp: number }> = []
    for (let i = 0; i < hourlyTimes.length; i++) {
      if (hourlyTimes[i]?.startsWith(targetDate) && hourlyTemps[i] !== null) {
        targetDayTemps.push({ time: hourlyTimes[i], temp: hourlyTemps[i] })
      }
    }

    // Get daily high/low for target date
    const dailyTimes: string[] = data.daily?.time || []
    const dailyHighs: number[] = data.daily?.[dailyHighKey] || data.daily?.temperature_2m_max || []
    const dailyLows: number[] = data.daily?.[dailyLowKey] || data.daily?.temperature_2m_min || []

    const dateIndex = dailyTimes.indexOf(targetDate)
    const dailyHigh = dateIndex >= 0 ? dailyHighs[dateIndex] : null
    const dailyLow = dateIndex >= 0 ? dailyLows[dateIndex] : null

    // Get last model run time
    const runSchedule = MODEL_RUN_TIMES[modelName]
    let runTime = '00Z'
    if (runSchedule) {
      const now = new Date()
      const currentHour = now.getUTCHours()
      if (runSchedule.runs === 'hourly') {
        runTime = `${String(Math.max(0, currentHour - runSchedule.delayHours)).padStart(2, '0')}Z`
      } else {
        // Find most recent run that would be available
        const availableHour = currentHour - runSchedule.delayHours
        let lastRun = runSchedule.runs[0]
        for (const run of runSchedule.runs) {
          if (run <= availableHour) {
            lastRun = run
          }
        }
        runTime = `${String(lastRun).padStart(2, '0')}Z`
      }
    }

    if (targetDayTemps.length > 0 || dailyHigh !== null) {
      models.push({
        name: modelName,
        runTime,
        hourlyTemps: targetDayTemps,
        dailyHigh,
        dailyLow
      })
    }
  }

  return models
}

async function fetchForecastEvolution(
  lat: number,
  lon: number,
  targetDate: string,
  unit: 'C' | 'F'
): Promise<ForecastEvolutionData[]> {
  const tempUnit = unit === 'F' ? 'fahrenheit' : 'celsius'

  // Use Previous Runs API to get historical forecasts
  const evolution: ForecastEvolutionData[] = []

  // Fetch previous runs for GFS, ECMWF, ICON
  const modelsToTrack = ['gfs_seamless', 'ecmwf_ifs04', 'icon_seamless']
  const modelNames = ['GFS', 'ECMWF', 'ICON']

  for (let i = 0; i < modelsToTrack.length; i++) {
    const modelId = modelsToTrack[i]
    const modelName = modelNames[i]

    const url = `${PREVIOUS_RUNS_API}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=${tempUnit}&timezone=auto&past_days=3&forecast_days=7&models=${modelId}`

    const data = await fetchWithTimeout(url, 10000)
    if (!data) continue

    // Extract runs from response
    const runs: Array<{ runDate: string; predictedHigh: number; predictedLow: number }> = []

    // The previous runs API returns data keyed by run time
    // We need to find predictions for our target date from each run
    const dailyTimes: string[] = data.daily?.time || []
    const targetIndex = dailyTimes.indexOf(targetDate)

    if (targetIndex >= 0) {
      const highKey = `temperature_2m_max_${modelId}`
      const lowKey = `temperature_2m_min_${modelId}`

      const highs = data.daily?.[highKey] || data.daily?.temperature_2m_max || []
      const lows = data.daily?.[lowKey] || data.daily?.temperature_2m_min || []

      if (highs[targetIndex] !== null && lows[targetIndex] !== null) {
        // For now, create a single run entry (the API structure varies)
        runs.push({
          runDate: new Date().toISOString().split('T')[0],
          predictedHigh: highs[targetIndex],
          predictedLow: lows[targetIndex]
        })
      }
    }

    // Determine trend
    let trend: 'warming' | 'cooling' | 'stable' = 'stable'
    if (runs.length >= 2) {
      const diff = runs[runs.length - 1].predictedHigh - runs[0].predictedHigh
      if (diff > 1) trend = 'warming'
      else if (diff < -1) trend = 'cooling'
    }

    if (runs.length > 0) {
      evolution.push({
        model: modelName,
        runs,
        trend
      })
    }
  }

  return evolution
}

async function fetchModelMetadata(): Promise<ModelUpdateInfo[]> {
  const updates: ModelUpdateInfo[] = []
  const now = Date.now()

  // Fetch metadata for each model in parallel
  const metadataPromises = Object.entries(MODEL_METADATA_IDS).map(async ([model, metadataId]) => {
    try {
      const url = `https://api.open-meteo.com/data/${metadataId}/static/meta.json`
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) return null

      const data = await response.json()

      // Parse timestamps from API
      const lastRunTime = data.last_run_initialisation_time * 1000 // Convert to ms
      const availableTime = data.last_run_availability_time * 1000
      const updateIntervalMs = data.update_interval_seconds * 1000

      // Calculate data age (time since model run)
      const dataAgeMs = now - lastRunTime

      // Calculate next update (availability time + update interval)
      const nextAvailableTime = availableTime + updateIntervalMs
      const minutesUntilNext = Math.max(0, Math.round((nextAvailableTime - now) / 60000))

      // Format last run time as "HHZ"
      const lastRunDate = new Date(lastRunTime)
      const lastRunHour = lastRunDate.getUTCHours()
      const lastRun = `${String(lastRunHour).padStart(2, '0')}Z`

      // Use absolute next availability timestamp for reliable countdowns
      const nextRunDate = new Date(nextAvailableTime)
      const nextRun = `${String(nextRunDate.getUTCHours()).padStart(2, '0')}Z`
      const nextRunAt = nextRunDate.toISOString()

      return {
        model,
        lastRun,
        nextRun,
        nextRunAt,
        minutesUntilNext,
        dataAgeMinutes: Math.round(dataAgeMs / 60000)
      }
    } catch {
      // Fallback to hardcoded schedule if metadata fetch fails
      const schedule = MODEL_RUN_TIMES[model]
      if (!schedule || schedule.runs === 'hourly') return null

      const currentHour = new Date().getUTCHours()
      const availableHour = currentHour - schedule.delayHours
      let lastRun = schedule.runs[0]
      let nextRun = schedule.runs[0]

      for (let i = 0; i < schedule.runs.length; i++) {
        if (schedule.runs[i] <= availableHour) {
          lastRun = schedule.runs[i]
          nextRun = schedule.runs[(i + 1) % schedule.runs.length]
        }
      }

      let hoursUntilNext = nextRun - currentHour + schedule.delayHours
      if (hoursUntilNext <= 0) hoursUntilNext += 24

      const minutesUntilNext = Math.max(0, hoursUntilNext * 60 - new Date().getUTCMinutes())
      const nextRunAt = new Date(now + minutesUntilNext * 60 * 1000).toISOString()

      return {
        model,
        lastRun: `${String(lastRun).padStart(2, '0')}Z`,
        nextRun: `${String(nextRun).padStart(2, '0')}Z`,
        nextRunAt,
        minutesUntilNext
      }
    }
  })

  const results = await Promise.all(metadataPromises)

  for (const result of results) {
    if (result) updates.push(result)
  }

  // Sort by minutes until next (soonest first)
  updates.sort((a, b) => a.minutesUntilNext - b.minutesUntilNext)

  return updates
}

function calculateBias(
  latestObsTemp: number | null,
  models: ModelData[],
  latestObsHour: number | null
): BiasData {
  // Simple approach: compare latest observation vs model forecasts at that hour
  if (latestObsTemp === null || latestObsHour === null || models.length === 0) {
    return { current: 'neutral', deviation: 0 }
  }

  // Find forecast temps at the observation hour from each model
  const forecastTemps: number[] = []

  for (const model of models) {
    for (const hourly of model.hourlyTemps) {
      // Extract hour from "2026-02-12T14:00" format
      const match = hourly.time.match(/T(\d{2}):/)
      if (match) {
        const forecastHour = parseInt(match[1])
        if (forecastHour === latestObsHour) {
          forecastTemps.push(hourly.temp)
          break // One per model
        }
      }
    }
  }

  if (forecastTemps.length === 0) {
    return { current: 'neutral', deviation: 0 }
  }

  const avgForecast = forecastTemps.reduce((a, b) => a + b, 0) / forecastTemps.length
  const deviation = latestObsTemp - avgForecast

  let current: 'warm' | 'cold' | 'neutral' = 'neutral'
  if (deviation > 2) current = 'warm'
  else if (deviation < -2) current = 'cold'

  return {
    current,
    deviation: Math.round(deviation * 10) / 10
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0')

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

  const stationRecord = getStationRecordByCity(city)
  const icaoCode = config.icaoCode || ''

  // Check cache
  const cacheKey = `analysis-${city}-${date}-${unit}`
  const cached = WEATHER_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.status(200).json(cached.data)
  }

  try {
    // Fetch all data in parallel
    const [primaryObs, baseModels, ecmwfModel, evolution, hourlyForecast] = await Promise.all([
      icaoCode ? fetchAviationWeatherMetar(icaoCode, date, unit, config.tz) : Promise.resolve([]),
      fetchMultiModelForecasts(config.geocode.lat, config.geocode.lon, date, unit),
      fetchECMWF(config.geocode.lat, config.geocode.lon, date, unit),
      fetchForecastEvolution(config.geocode.lat, config.geocode.lon, date, unit),
      fetchHourlyForecast(config.geocode.lat, config.geocode.lon, date, unit)
    ])

    // Fallback to Iowa Mesonet if aviationweather.gov returns no data
    let observations = primaryObs
    if (observations.length === 0 && icaoCode) {
      observations = await fetchIowaMetar(icaoCode, date, unit)
    }

    // Filter observations to only include those from the target date in LOCAL timezone
    // This ensures we don't show yesterday's observations for today's market
    const filterByLocalDate = (obs: DecodedMetar[]): DecodedMetar[] => {
      return obs.filter(o => {
        if (!o.time) return false
        const utcTimeStr = o.time.includes('Z') || o.time.includes('+')
          ? o.time
          : o.time.replace(' ', 'T') + 'Z'
        const utcTime = new Date(utcTimeStr)
        const localDateStr = utcTime.toLocaleDateString('en-CA', { timeZone: config.tz })
        return localDateStr === date
      })
    }
    observations = filterByLocalDate(observations)

    // Merge ECMWF with other models
    const models = ecmwfModel ? [...baseModels, ecmwfModel] : baseModels

    // Calculate high/low from observations
    let observedHigh: number | null = null
    let observedLow: number | null = null

    for (const obs of observations) {
      if (obs.temp !== null) {
        if (observedHigh === null || obs.temp > observedHigh) {
          observedHigh = obs.temp
        }
        if (observedLow === null || obs.temp < observedLow) {
          observedLow = obs.temp
        }
      }
    }

    // Extract forecast highs/lows from models
    const forecastHigh: Array<{ model: string; value: number }> = []
    const forecastLow: Array<{ model: string; value: number }> = []

    for (const model of models) {
      if (model.dailyHigh !== null) {
        forecastHigh.push({ model: model.name, value: model.dailyHigh })
      }
      if (model.dailyLow !== null) {
        forecastLow.push({ model: model.name, value: model.dailyLow })
      }
    }

    // Calculate consensus
    let consensus: { high: number; low: number } | null = null
    if (forecastHigh.length > 0 && forecastLow.length > 0) {
      const avgHigh = forecastHigh.reduce((sum, f) => sum + f.value, 0) / forecastHigh.length
      const avgLow = forecastLow.reduce((sum, f) => sum + f.value, 0) / forecastLow.length
      consensus = {
        high: Math.round(avgHigh * 10) / 10,
        low: Math.round(avgLow * 10) / 10
      }
    }

    // Helper to parse observation time (handles both ISO and Iowa formats)
    const parseObsTime = (timeStr: string): number => {
      // If already has Z or timezone info, parse directly
      if (timeStr.includes('Z') || timeStr.includes('+')) {
        return new Date(timeStr).getTime()
      }
      // Iowa format: "2026-02-12 00:50" - convert to ISO and add Z
      return new Date(timeStr.replace(' ', 'T') + 'Z').getTime()
    }

    // Calculate METAR update timing based on observation pattern
    const lastObsTime = observations.length > 0 ? observations[0].time : null
    let updateInterval = 20 // Display value
    let nextUpdateIn = 0
    const DATA_DELAY_MINUTES = 3 // Time for data to become available after observation

    if (lastObsTime) {
      const lastTime = parseObsTime(lastObsTime)
      const lastMinute = new Date(lastTime).getUTCMinutes()

      // Detect pattern by looking at the actual minutes in observations
      const minutes = observations.slice(0, 8).map(obs => {
        const t = parseObsTime(obs.time)
        return new Date(t).getUTCMinutes()
      })

      // Find unique minute slots (rounded to nearest 5)
      const slots = [...new Set(minutes.map(m => Math.round(m / 5) * 5))]

      let nextObsTime: number
      const nextTime = new Date(lastTime)

      // Check for :00/:20 pattern (no :40)
      const has00 = slots.some(s => s <= 5 || s >= 55)
      const has20 = slots.some(s => s >= 15 && s <= 25)
      const has40 = slots.some(s => s >= 35 && s <= 45)
      const has50 = slots.some(s => s >= 45 && s <= 55)

      if (has00 && has20 && !has40) {
        // Pattern: :00 and :20 only (20 min then 40 min)
        if (lastMinute >= 0 && lastMinute < 15) {
          // Last was around :00, next at :20 (20 min)
          nextTime.setUTCMinutes(20, 0, 0)
          updateInterval = 20
        } else {
          // Last was around :20, next at :00 of next hour (40 min)
          nextTime.setUTCHours(nextTime.getUTCHours() + 1)
          nextTime.setUTCMinutes(0, 0, 0)
          updateInterval = 40
        }
        nextObsTime = nextTime.getTime()
      } else if (has00 && has20 && has40) {
        // Pattern: :00, :20, :40 (every 20 min)
        updateInterval = 20
        const nextSlot = Math.ceil((lastMinute + 1) / 20) * 20
        if (nextSlot >= 60) {
          nextTime.setUTCHours(nextTime.getUTCHours() + 1)
          nextTime.setUTCMinutes(0, 0, 0)
        } else {
          nextTime.setUTCMinutes(nextSlot, 0, 0)
        }
        nextObsTime = nextTime.getTime()
      } else if (has50 && !has20 && !has40) {
        // Hourly pattern at :50
        updateInterval = 60
        nextTime.setUTCMinutes(50, 0, 0)
        if (nextTime.getTime() <= lastTime) {
          nextTime.setUTCHours(nextTime.getUTCHours() + 1)
        }
        nextObsTime = nextTime.getTime()
      } else {
        // Default: assume next report in ~30 min
        updateInterval = 30
        nextObsTime = lastTime + 30 * 60 * 1000
      }

      // Add delay for data availability
      const nextAvailableTime = nextObsTime + DATA_DELAY_MINUTES * 60 * 1000
      nextUpdateIn = Math.max(0, Math.round((nextAvailableTime - Date.now()) / 60000))
    }

    // Get current local time
    const localTime = new Date().toLocaleTimeString('en-US', {
      timeZone: config.tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })

    // Calculate hours to resolution
    const targetEnd = new Date(`${date}T23:59:59`)
    const hoursToResolution = Math.max(0, Math.round((targetEnd.getTime() - Date.now()) / 3600000))

    const response: WeatherAnalysisResponse = {
      station: {
        city,
        icaoCode,
        timezone: config.tz,
        localTime,
        coordinates: config.geocode
      },
      target: {
        date,
        marketBucket: null, // Will be set by frontend based on market data
        unit,
        hoursToResolution
      },
      highLow: {
        observedHigh,
        observedLow,
        forecastHigh,
        forecastLow,
        consensus
      },
      models,
      forecastEvolution: evolution,
      observations,
      metar: {
        lastUpdate: lastObsTime || '',
        nextUpdateIn,
        updateInterval
      },
      bias: (() => {
        // Get latest observation temp and hour for bias calculation
        const latestObs = observations[0]
        if (!latestObs?.temp || !latestObs?.time) {
          return { current: 'neutral' as const, deviation: 0 }
        }
        // Parse hour from observation time (in UTC)
        const obsTimeStr = latestObs.time.includes('Z') || latestObs.time.includes('+')
          ? latestObs.time
          : latestObs.time.replace(' ', 'T') + 'Z'
        const obsDate = new Date(obsTimeStr)
        // Convert to local hour in station's timezone
        const localHour = parseInt(obsDate.toLocaleString('en-US', {
          timeZone: config.tz,
          hour: 'numeric',
          hour12: false
        }))
        return calculateBias(latestObs.temp, models, localHour)
      })(),
      modelUpdates: await fetchModelMetadata(),
      hourlyForecast
    }

    WEATHER_CACHE.set(cacheKey, { data: response, ts: Date.now() })
    return res.status(200).json(response)
  } catch (error) {
    console.error('weather-analysis error', error)
    return res.status(500).json({ error: 'Failed to fetch weather analysis data' })
  }
}
