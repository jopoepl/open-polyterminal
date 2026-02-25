/**
 * METAR Decoder - Parses and decodes METAR weather reports into human-readable format
 */

export interface DecodedMetar {
  time: string
  temp: number | null
  tempUnit: 'C' | 'F'
  dewPoint: number | null
  wind: {
    direction: number | null
    directionCardinal: string | null
    speed: number | null
    gust: number | null
    unit: string
  }
  visibility: number | null
  visibilityUnit: string
  skyCondition: string | null
  skyLayers: Array<{ cover: string; altitude: number | null; decoded: string }>
  weather: string | null
  pressure: number | null
  pressureUnit: string
  humidity: number | null
  raw: string
}

const CARDINAL_DIRECTIONS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
]

const SKY_COVER_MAP: Record<string, string> = {
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

const WEATHER_PHENOMENA: Record<string, string> = {
  // Intensity
  '-': 'Light ',
  '+': 'Heavy ',
  'VC': 'In vicinity ',

  // Descriptors
  'MI': 'Shallow ',
  'BC': 'Patches of ',
  'PR': 'Partial ',
  'DR': 'Low drifting ',
  'BL': 'Blowing ',
  'SH': 'Showers ',
  'TS': 'Thunderstorm ',
  'FZ': 'Freezing ',

  // Precipitation
  'RA': 'Rain',
  'DZ': 'Drizzle',
  'SN': 'Snow',
  'SG': 'Snow grains',
  'IC': 'Ice crystals',
  'PL': 'Ice pellets',
  'GR': 'Hail',
  'GS': 'Small hail',
  'UP': 'Unknown precipitation',

  // Obscurations
  'FG': 'Fog',
  'BR': 'Mist',
  'HZ': 'Haze',
  'FU': 'Smoke',
  'VA': 'Volcanic ash',
  'DU': 'Dust',
  'SA': 'Sand',
  'PY': 'Spray',

  // Other
  'SQ': 'Squall',
  'PO': 'Dust/sand whirls',
  'DS': 'Duststorm',
  'SS': 'Sandstorm',
  'FC': 'Funnel cloud'
}

export function degreesToCardinal(degrees: number | null): string | null {
  if (degrees === null || !Number.isFinite(degrees)) return null
  const index = Math.round(degrees / 22.5) % 16
  return CARDINAL_DIRECTIONS[index]
}

export function decodeSkyCover(code: string, altitude: number | null): string {
  const coverText = SKY_COVER_MAP[code] || code
  if (altitude === null) return coverText
  const altFeet = altitude * 100
  return `${coverText} at ${altFeet.toLocaleString()}ft`
}

export function decodeWeatherPhenomena(wx: string): string {
  if (!wx) return ''

  let decoded = ''
  let remaining = wx.toUpperCase()

  // Check for intensity prefix
  if (remaining.startsWith('-') || remaining.startsWith('+')) {
    decoded += WEATHER_PHENOMENA[remaining[0]] || ''
    remaining = remaining.slice(1)
  }

  // Check for vicinity
  if (remaining.startsWith('VC')) {
    decoded += WEATHER_PHENOMENA['VC'] || ''
    remaining = remaining.slice(2)
  }

  // Process in pairs
  while (remaining.length >= 2) {
    const pair = remaining.slice(0, 2)
    decoded += WEATHER_PHENOMENA[pair] || pair
    remaining = remaining.slice(2)
  }

  return decoded.trim()
}

export function calculateHumidity(tempC: number, dewPointC: number): number {
  // Magnus formula for relative humidity
  const a = 17.27
  const b = 237.7

  const alpha = (a * dewPointC) / (b + dewPointC)
  const beta = (a * tempC) / (b + tempC)

  const humidity = 100 * Math.exp(alpha - beta)
  return Math.round(Math.max(0, Math.min(100, humidity)))
}

export function celsiusToFahrenheit(c: number): number {
  return Math.round((c * 9/5 + 32) * 10) / 10
}

export function fahrenheitToCelsius(f: number): number {
  return Math.round(((f - 32) * 5/9) * 10) / 10
}

export interface RawMetarData {
  temp?: number | null
  dewp?: number | null
  wdir?: number | null
  wspd?: number | null
  wgst?: number | null
  visib?: number | null
  clouds?: Array<{ cover: string; base?: number }> | null
  wxString?: string | null
  altim?: number | null
  reportTime?: string | null
  rawOb?: string | null
}

export function decodeMetar(metar: RawMetarData, targetUnit: 'C' | 'F' = 'C'): DecodedMetar {
  const tempC = metar.temp ?? null
  const dewPointC = metar.dewp ?? null

  const temp = tempC !== null
    ? (targetUnit === 'F' ? celsiusToFahrenheit(tempC) : tempC)
    : null

  const dewPoint = dewPointC !== null
    ? (targetUnit === 'F' ? celsiusToFahrenheit(dewPointC) : dewPointC)
    : null

  const windDir = metar.wdir ?? null

  const skyLayers = (metar.clouds || []).map(cloud => ({
    cover: cloud.cover,
    altitude: cloud.base ?? null,
    decoded: decodeSkyCover(cloud.cover, cloud.base ?? null)
  }))

  let skyCondition: string | null = null
  if (skyLayers.length > 0) {
    // Use the highest coverage layer
    const coverOrder = ['CLR', 'SKC', 'NSC', 'NCD', 'FEW', 'SCT', 'BKN', 'OVC', 'VV']
    let highestCover = skyLayers[0]
    for (const layer of skyLayers) {
      const currentIndex = coverOrder.indexOf(layer.cover)
      const highestIndex = coverOrder.indexOf(highestCover.cover)
      if (currentIndex > highestIndex) {
        highestCover = layer
      }
    }
    skyCondition = highestCover.decoded
  } else {
    skyCondition = 'Clear'
  }

  const weather = metar.wxString ? decodeWeatherPhenomena(metar.wxString) : null

  const humidity = (tempC !== null && dewPointC !== null)
    ? calculateHumidity(tempC, dewPointC)
    : null

  return {
    time: metar.reportTime || '',
    temp,
    tempUnit: targetUnit,
    dewPoint,
    wind: {
      direction: windDir,
      directionCardinal: degreesToCardinal(windDir),
      speed: metar.wspd ?? null,
      gust: metar.wgst ?? null,
      unit: 'kt'
    },
    visibility: metar.visib ?? null,
    visibilityUnit: 'mi',
    skyCondition,
    skyLayers,
    weather,
    pressure: metar.altim ?? null,
    pressureUnit: 'hPa',
    humidity,
    raw: metar.rawOb || ''
  }
}

export interface IowaMetarRow {
  station: string
  valid: string  // timestamp
  tmpf?: number | string
  dwpf?: number | string
  drct?: number | string
  sknt?: number | string
  gust?: number | string
  vsby?: number | string
  skyc1?: string
  skyc2?: string
  skyc3?: string
  skyl1?: number | string
  skyl2?: number | string
  skyl3?: number | string
  wxcodes?: string
  alti?: number | string
  metar?: string
}

export function parseIowaMetar(row: IowaMetarRow, targetUnit: 'C' | 'F' = 'F'): DecodedMetar {
  const parseNum = (val: any): number | null => {
    if (val === null || val === undefined || val === '' || val === 'M') return null
    const num = Number(val)
    return Number.isFinite(num) ? num : null
  }

  // Iowa Mesonet returns temps in Fahrenheit
  const tempF = parseNum(row.tmpf)
  const dewPointF = parseNum(row.dwpf)

  const temp = tempF !== null
    ? (targetUnit === 'C' ? fahrenheitToCelsius(tempF) : tempF)
    : null

  const dewPoint = dewPointF !== null
    ? (targetUnit === 'C' ? fahrenheitToCelsius(dewPointF) : dewPointF)
    : null

  const windDir = parseNum(row.drct)
  const windSpeed = parseNum(row.sknt)
  const windGust = parseNum(row.gust)
  const visibility = parseNum(row.vsby)

  // Parse sky layers
  const skyLayers: Array<{ cover: string; altitude: number | null; decoded: string }> = []
  const skyCodes = [row.skyc1, row.skyc2, row.skyc3]
  const skyAltitudes = [row.skyl1, row.skyl2, row.skyl3]

  for (let i = 0; i < skyCodes.length; i++) {
    const code = skyCodes[i]
    if (code && code !== 'M' && code !== '') {
      const alt = parseNum(skyAltitudes[i])
      // Iowa gives altitude in feet, we need hundreds of feet for our decoder
      const altHundreds = alt !== null ? Math.round(alt / 100) : null
      skyLayers.push({
        cover: code,
        altitude: altHundreds,
        decoded: decodeSkyCover(code, altHundreds)
      })
    }
  }

  let skyCondition: string | null = 'Clear'
  if (skyLayers.length > 0) {
    const coverOrder = ['CLR', 'SKC', 'NSC', 'NCD', 'FEW', 'SCT', 'BKN', 'OVC', 'VV']
    let highestCover = skyLayers[0]
    for (const layer of skyLayers) {
      const currentIndex = coverOrder.indexOf(layer.cover)
      const highestIndex = coverOrder.indexOf(highestCover.cover)
      if (currentIndex > highestIndex) {
        highestCover = layer
      }
    }
    skyCondition = highestCover.decoded
  }

  const weather = row.wxcodes ? decodeWeatherPhenomena(row.wxcodes) : null
  const pressure = parseNum(row.alti)
  // Convert altimeter (inHg) to hPa
  const pressureHpa = pressure !== null ? Math.round(pressure * 33.8639) : null

  // Calculate humidity from Fahrenheit temps
  const humidityTempC = tempF !== null ? fahrenheitToCelsius(tempF) : null
  const humidityDewC = dewPointF !== null ? fahrenheitToCelsius(dewPointF) : null
  const humidity = (humidityTempC !== null && humidityDewC !== null)
    ? calculateHumidity(humidityTempC, humidityDewC)
    : null

  return {
    time: row.valid,
    temp,
    tempUnit: targetUnit,
    dewPoint,
    wind: {
      direction: windDir,
      directionCardinal: degreesToCardinal(windDir),
      speed: windSpeed,
      gust: windGust,
      unit: 'kt'
    },
    visibility,
    visibilityUnit: 'mi',
    skyCondition,
    skyLayers,
    weather,
    pressure: pressureHpa,
    pressureUnit: 'hPa',
    humidity,
    raw: row.metar || ''
  }
}

export function formatWindDescription(wind: DecodedMetar['wind']): string {
  if (wind.speed === null || wind.speed === 0) return 'Calm'

  const dir = wind.directionCardinal || (wind.direction !== null ? `${wind.direction}°` : '')
  const gust = wind.gust ? ` gusting ${wind.gust}${wind.unit}` : ''

  return `${dir} at ${wind.speed}${wind.unit}${gust}`
}

export function formatVisibility(vis: number | null): string {
  if (vis === null) return '--'
  if (vis >= 10) return '10+ mi'
  if (vis < 1) return `${(vis * 5280).toFixed(0)}ft`
  return `${vis.toFixed(1)} mi`
}
