export type HistoricalPeriod = 'yesterday' | '3d' | '5d' | '1w' | '10d' | '15d' | '1m'

export type HistoricalResolution = 'daily'
export type HistoricalScoringMode = 'day_ahead' | 'latest_available'

export interface HistoricalPolicy {
  evaluationWindow: 'completed_local_days'
  observationSource: 'iowa_mesonet_metar'
  forecastSource: 'open_meteo_historical_forecast'
  scoringMode: HistoricalScoringMode
  leadTimeHours: number
  minSamplesPerModel: number
  accuracyThresholdDegrees: number
  stationTimezone: string
}

export interface ModelDailyPoint {
  model: string
  predictedHigh: number | null
  error: number | null
}

export interface HistoricalDailySeriesPoint {
  date: string
  observedHigh: number | null
  observedHighAt: string | null
  observationCount: number
  models: ModelDailyPoint[]
}

export interface HistoricalHourlyPoint {
  hour: number
  observed: number | null
  forecast: number | null
  error: number | null
}

export interface HistoricalHourlyModelSeries {
  model: string
  points: HistoricalHourlyPoint[]
  meanError: number | null
  mae: number | null
  sampleCount: number
  warmHours: number
  coldHours: number
}

export interface HistoricalHourlyDaySeries {
  date: string
  observedHourCount: number
  models: HistoricalHourlyModelSeries[]
}

export interface HistoricalHourlyWindow {
  start: string
  end: string
  days: number
  defaultModel: string | null
  series: HistoricalHourlyDaySeries[]
}

export interface ModelAccuracyRow {
  model: string
  mae: number | null
  rmse: number | null
  bias: number | null
  accuracyPct: number | null
  sampleCount: number
  coveragePct: number
  eligible: boolean
  rank: number | null
  errorTrend: Array<{ date: string; error: number }>
}

export interface HistoricalAccuracyResponse {
  station: {
    city: string
    icaoCode: string
    timezone: string
    coordinates: { lat: number; lon: number }
  }
  period: {
    key: HistoricalPeriod
    start: string
    end: string
    days: number
  }
  resolution: HistoricalResolution
  policy: HistoricalPolicy
  dailySeries: HistoricalDailySeriesPoint[]
  hourly: HistoricalHourlyWindow
  modelAccuracy: ModelAccuracyRow[]
  bestModel: { name: string; mae: number } | null
  warnings: string[]
}
