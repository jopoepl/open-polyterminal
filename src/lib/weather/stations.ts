import stationsJson from '@/data/weather-stations.json'

export interface CityConfig {
  tz: string
  icaoCode?: string
  geocode: { lat: number; lon: number }
  metarInterval?: 30 | 60
}

interface WeatherStationRecord {
  city: string
  icaoCode: string
  geocode: { lat: number; lon: number }
  tz: string
  aliases?: string[]
  resolutionSource?: string
  metarInterval?: 30 | 60 // METAR update interval in minutes
}

const STATIONS = stationsJson as WeatherStationRecord[]

export const CITY_CONFIG: Record<string, CityConfig> = Object.fromEntries(
  STATIONS.map((station) => [
    station.city,
    {
      tz: station.tz,
      icaoCode: station.icaoCode,
      geocode: station.geocode,
      metarInterval: station.metarInterval || 60
    }
  ])
)

export function getMetarInterval(city: string): number {
  return CITY_CONFIG[city]?.metarInterval || 60
}

const cityKeys = Object.keys(CITY_CONFIG)
const aliasRows = STATIONS.flatMap((station) => {
  const aliases = new Set<string>([station.city, ...(station.aliases || [])])
  return Array.from(aliases).map((alias) => ({
    alias: alias.toLowerCase(),
    city: station.city
  }))
}).sort((left, right) => right.alias.length - left.alias.length)

export function extractCityFromText(text: string): string | null {
  const lower = text.toLowerCase()
  for (const { alias, city } of aliasRows) {
    if (lower.includes(alias)) return city
  }
  return null
}

export function listStationCities() {
  return cityKeys
}

export function getStationRecordByCity(city: string) {
  const normalized = city.trim().toLowerCase()
  return STATIONS.find((station) => station.city.toLowerCase() === normalized) || null
}
