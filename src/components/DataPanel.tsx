import type { MarketCategoryId, MarketEvent } from '@/types'
import { CITY_CONFIG } from '@/lib/weather/stations'
import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import {
  TempSummary,
  ForecastChart,
  ForecastEvolution,
  ObservationsTable,
  BiasIndicator,
  ShortTermForecast
} from './analysis'

interface PreloadedAnalysis {
  data: WeatherAnalysisResponse | null
  loading: boolean
  error: Error | null
}

interface PreloadedParsed {
  city: string
  targetDate: string
  unit: 'C' | 'F'
  marketBucket: { low: number; high: number } | null
}

interface DataPanelProps {
  selectedEvent: MarketEvent | null
  category: MarketCategoryId
  theme?: 'dark' | 'light'
  preloadedAnalysis?: PreloadedAnalysis
  preloadedParsed?: PreloadedParsed | null
}

export default function DataPanel({ selectedEvent, category, theme = 'dark', preloadedAnalysis, preloadedParsed }: DataPanelProps) {
  const isWeatherEvent = selectedEvent?.category === 'weather'

  // Use preloaded data from parent component
  const parsed = preloadedParsed ?? null
  const data = preloadedAnalysis?.data ?? null
  const loading = preloadedAnalysis?.loading ?? false
  const error = preloadedAnalysis?.error ?? null

  if (!selectedEvent) {
    return <div className="empty-state">Select a market to view data</div>
  }

  if (!isWeatherEvent) {
    return (
      <div className="data-panel-placeholder">
        <div className="data-placeholder-title">No data available</div>
      </div>
    )
  }

  if (!parsed) {
    return (
      <div className="data-panel-placeholder">
        <div className="data-placeholder-title">No data available</div>
      </div>
    )
  }

  if (loading && !data) {
    return <div className="analysis-dashboard-loading">Loading weather analysis...</div>
  }

  if (error && !data) {
    return (
      <div className="data-panel-placeholder">
        <div className="data-placeholder-title">Failed to load weather data</div>
        <div className="data-placeholder-text">{error.message}</div>
      </div>
    )
  }

  if (!data) {
    return <div className="analysis-dashboard-loading">Loading...</div>
  }

  const cityConfig = CITY_CONFIG[parsed.city]

  return (
    <div className="analysis-dashboard">
      <TempSummary data={data} />

      <ShortTermForecast data={data} />

      <ForecastChart data={data} theme={theme} marketBucket={parsed.marketBucket} />

      <BiasIndicator data={data} />

      <ObservationsTable data={data} />

      <ForecastEvolution data={data} />

      {cityConfig && (
        <div className="data-links">
          <div className="data-section-title">External Sources</div>
          <div className="data-links-list">
            <a
              href={`https://www.windy.com/${cityConfig.geocode.lat}/${cityConfig.geocode.lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="data-link"
            >
              Windy.com
            </a>
            {cityConfig.icaoCode && (
              <a
                href={`https://aviationweather.gov/data/metar/?ids=${cityConfig.icaoCode}&hours=6&tabular=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="data-link"
              >
                METAR ({cityConfig.icaoCode})
              </a>
            )}
            <a
              href={`https://mesonet.agron.iastate.edu/request/daily.phtml`}
              target="_blank"
              rel="noopener noreferrer"
              className="data-link"
            >
              Iowa Mesonet
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
