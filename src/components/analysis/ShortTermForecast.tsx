import type { WeatherAnalysisResponse, HourlyForecastPoint } from '@/pages/api/weather-analysis'
import InfoTooltip from './InfoTooltip'

interface ShortTermForecastProps {
  data: WeatherAnalysisResponse
}

// Get weather emoji based on weather code
function getWeatherIcon(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 57) return '🌧️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '🌨️'
  if (code <= 82) return '🌦️'
  if (code <= 86) return '🌨️'
  if (code >= 95) return '⛈️'
  return '☁️'
}

// Convert wind direction degrees to cardinal
function getWindDirection(deg: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(deg / 22.5) % 16
  return directions[index]
}

interface ForecastWindow {
  label: string
  timeRange: string
  points: HourlyForecastPoint[]
  high: number
  low: number
  maxPrecipProb: number
  avgWind: number
  maxGusts: number
  avgWindDir: number
  dominantCondition: string
  dominantCode: number
  avgHumidity: number
  avgFeelsLike: number
}

export default function ShortTermForecast({ data }: ShortTermForecastProps) {
  const { hourlyForecast, target } = data

  // Calculate forecast windows for the target date
  // Morning: 6am-12pm, Afternoon: 12pm-6pm, Evening: 6pm-12am
  const calculateWindow = (
    label: string,
    startHour: number,
    endHour: number
  ): ForecastWindow | null => {
    const points = hourlyForecast.filter(pt => {
      const hour = parseInt(pt.time.split('T')[1]?.split(':')[0] || '0')
      return hour >= startHour && hour < endHour
    })

    if (points.length === 0) return null

    const temps = points.map(p => p.temp)
    const feelsLikes = points.map(p => p.feelsLike)
    const winds = points.map(p => p.windSpeed)
    const gusts = points.map(p => p.windGusts)
    const windDirs = points.map(p => p.windDirection)
    const precipProbs = points.map(p => p.precipProbability)
    const humidities = points.map(p => p.humidity)

    // Find most common weather condition
    const conditionCounts = new Map<number, number>()
    for (const pt of points) {
      conditionCounts.set(pt.weatherCode, (conditionCounts.get(pt.weatherCode) || 0) + 1)
    }
    let dominantCode = 0
    let maxCount = 0
    for (const [code, count] of conditionCounts) {
      if (count > maxCount) {
        maxCount = count
        dominantCode = code
      }
    }

    const formatHour = (h: number) => {
      if (h === 0 || h === 24) return '12am'
      if (h === 12) return '12pm'
      return h < 12 ? `${h}am` : `${h - 12}pm`
    }

    return {
      label,
      timeRange: `${formatHour(startHour)} - ${formatHour(endHour)}`,
      points,
      high: Math.max(...temps),
      low: Math.min(...temps),
      maxPrecipProb: Math.max(...precipProbs),
      avgWind: Math.round(winds.reduce((a, b) => a + b, 0) / winds.length),
      maxGusts: Math.max(...gusts),
      avgWindDir: Math.round(windDirs.reduce((a, b) => a + b, 0) / windDirs.length),
      dominantCondition: points.find(p => p.weatherCode === dominantCode)?.weatherDescription || 'Unknown',
      dominantCode,
      avgHumidity: Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length),
      avgFeelsLike: Math.round(feelsLikes.reduce((a, b) => a + b, 0) / feelsLikes.length),
    }
  }

  const windows = [
    calculateWindow('Morning', 6, 12),
    calculateWindow('Afternoon', 12, 18),
    calculateWindow('Evening', 18, 24)
  ].filter((w): w is ForecastWindow => w !== null)

  const formatTemp = (temp: number) => `${Math.round(temp)}°${target.unit}`

  // Check if target date is today
  const today = new Date().toISOString().split('T')[0]
  const isToday = target.date === today
  const dateLabel = isToday ? 'Today' : new Date(target.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })

  if (windows.length === 0) {
    return (
      <div className="analysis-shortterm-section">
        <div className="analysis-section-header">
          <div className="analysis-section-title">
            Forecast for {dateLabel}
            <InfoTooltip text="Detailed weather forecast for the market resolution date." />
          </div>
        </div>
        <div className="analysis-empty">No forecast data available for {dateLabel}</div>
      </div>
    )
  }

  return (
    <div className="analysis-shortterm-section">
      <div className="analysis-section-header">
        <div className="analysis-section-title">
          Forecast for {dateLabel}
          <InfoTooltip text={`Weather forecast for ${dateLabel} showing morning (6am-12pm), afternoon (12pm-6pm), and evening (6pm-12am) conditions for the market resolution date.`} />
        </div>
      </div>

      <div className="analysis-shortterm-grid">
        {windows.map(window => (
          <div key={window.label} className="analysis-shortterm-card">
            <div className="shortterm-header">
              <div className="shortterm-label-wrap">
                <span className="shortterm-label">{window.label}</span>
                <span className="shortterm-timerange">{window.timeRange}</span>
              </div>
              <span className="shortterm-icon">{getWeatherIcon(window.dominantCode)}</span>
            </div>

            <div className="shortterm-condition">{window.dominantCondition}</div>

            <div className="shortterm-temps">
              <span className="shortterm-high">{formatTemp(window.high)}</span>
              <span className="shortterm-separator">/</span>
              <span className="shortterm-low">{formatTemp(window.low)}</span>
            </div>

            <div className="shortterm-details">
              <div className="shortterm-detail-row">
                <span className="shortterm-detail-icon">🌡️</span>
                <span className="shortterm-detail-label">Feels</span>
                <span className="shortterm-detail-value">{formatTemp(window.avgFeelsLike)}</span>
              </div>

              <div className="shortterm-detail-row">
                <span className="shortterm-detail-icon">💧</span>
                <span className="shortterm-detail-label">Precip</span>
                <span className={`shortterm-detail-value ${window.maxPrecipProb > 50 ? 'precip-high' : window.maxPrecipProb > 20 ? 'precip-med' : ''}`}>
                  {window.maxPrecipProb}%
                </span>
              </div>

              <div className="shortterm-detail-row">
                <span className="shortterm-detail-icon">💨</span>
                <span className="shortterm-detail-label">Wind</span>
                <span className="shortterm-detail-value">
                  {getWindDirection(window.avgWindDir)} {window.avgWind}kt
                  {window.maxGusts > window.avgWind + 5 && (
                    <span className="shortterm-gusts"> G{window.maxGusts}</span>
                  )}
                </span>
              </div>

              <div className="shortterm-detail-row">
                <span className="shortterm-detail-icon">💦</span>
                <span className="shortterm-detail-label">Humidity</span>
                <span className="shortterm-detail-value">{window.avgHumidity}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
