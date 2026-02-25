import { formatWindDescription, formatVisibility } from '@/lib/weather/metar-decoder'
import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import InfoTooltip from './InfoTooltip'

interface TempSummaryProps {
  data: WeatherAnalysisResponse
}

export default function TempSummary({ data }: TempSummaryProps) {
  const { station, target, observations, highLow } = data

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatTemp = (temp: number | null) => {
    if (temp === null) return '--'
    return `${Math.round(temp)}°${target.unit}`
  }

  // Get current conditions from latest observation
  const currentObs = observations[0] || null

  // Calculate how long ago the observation was
  const getObsAge = () => {
    if (!currentObs?.time) return null
    // Handle both ISO format (with Z) and space-separated format (without Z)
    const timeStr = currentObs.time.includes('Z') || currentObs.time.includes('+')
      ? currentObs.time
      : currentObs.time.replace(' ', 'T') + 'Z'
    const obsTime = new Date(timeStr).getTime()
    if (isNaN(obsTime)) return null
    const minutesAgo = Math.round((Date.now() - obsTime) / 60000)
    if (minutesAgo < 1) return 'just now'
    if (minutesAgo === 1) return '1 min ago'
    if (minutesAgo < 60) return `${minutesAgo} min ago`
    const hoursAgo = Math.floor(minutesAgo / 60)
    if (hoursAgo === 1) return '1 hr ago'
    return `${hoursAgo} hrs ago`
  }

  return (
    <div className="analysis-temp-summary">
      <div className="analysis-header">
        <div className="analysis-header-left">
          <div className="analysis-city">
            {station.city}
            {station.icaoCode && <span className="analysis-icao"> ({station.icaoCode})</span>}
            <InfoTooltip text="Live weather data from this airport's official weather station (METAR reports)." />
          </div>
          <div className="analysis-localtime">{station.localTime} local</div>
        </div>
        <div className="analysis-header-right">
          <div className="analysis-date">{formatDate(target.date)}</div>
        </div>
      </div>

      {currentObs ? (
        <div className="current-weather">
          <div className="current-weather-header">
            <span className="current-weather-title">Current Weather</span>
            {getObsAge() && <span className="current-weather-age">{getObsAge()}</span>}
            <InfoTooltip text="Last observed conditions from the resolution airport weather station (METAR)." />
          </div>
          <div className="current-weather-main">
            <div className="current-temp">{formatTemp(currentObs.temp)}</div>
            <div className="current-conditions">
              <div className="current-sky">{currentObs.skyCondition || 'Clear'}</div>
              {currentObs.weather && <div className="current-wx">{currentObs.weather}</div>}
            </div>
          </div>
          <div className="current-weather-details">
            <div className="current-detail">
              <span className="current-detail-label">Feels like</span>
              <span className="current-detail-value">{formatTemp(currentObs.temp)}</span>
            </div>
            <div className="current-detail">
              <span className="current-detail-label">Wind</span>
              <span className="current-detail-value">{formatWindDescription(currentObs.wind)}</span>
            </div>
            <div className="current-detail">
              <span className="current-detail-label">Visibility</span>
              <span className="current-detail-value">{formatVisibility(currentObs.visibility)}</span>
            </div>
            {currentObs.humidity && (
              <div className="current-detail">
                <span className="current-detail-label">Humidity</span>
                <span className="current-detail-value">{currentObs.humidity}%</span>
              </div>
            )}
            {currentObs.pressure && (
              <div className="current-detail">
                <span className="current-detail-label">Pressure</span>
                <span className="current-detail-value">{currentObs.pressure} hPa</span>
              </div>
            )}
            {currentObs.dewPoint !== null && (
              <div className="current-detail">
                <span className="current-detail-label">Dew Point</span>
                <span className="current-detail-value">{formatTemp(currentObs.dewPoint)}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="current-weather-empty">No current observations available</div>
      )}

      <div className="forecast-comparison">
        <div className="forecast-item">
          <span className="forecast-label">Forecast High:</span>
          <span className="forecast-value">{highLow.consensus ? formatTemp(highLow.consensus.high) : '--'}</span>
          {highLow.consensus && <span className="forecast-source">({highLow.forecastHigh.length} models)</span>}
        </div>
        <div className="forecast-item">
          <span className="forecast-label">Forecast Low:</span>
          <span className="forecast-value">{highLow.consensus ? formatTemp(highLow.consensus.low) : '--'}</span>
          {highLow.consensus && <span className="forecast-source">({highLow.forecastLow.length} models)</span>}
        </div>
      </div>
    </div>
  )
}
