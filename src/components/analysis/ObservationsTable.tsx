import { useLiveCountdown } from '@/hooks/useWeatherAnalysis'
import { formatWindDescription, formatVisibility } from '@/lib/weather/metar-decoder'
import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import InfoTooltip from './InfoTooltip'

interface ObservationsTableProps {
  data: WeatherAnalysisResponse
}

export default function ObservationsTable({ data }: ObservationsTableProps) {
  const { observations, metar, station, target, highLow } = data
  const nextUpdateCountdown = useLiveCountdown(metar.nextUpdateIn)
  const timezone = station.timezone || 'UTC'

  // Check if target date has started in the station's local timezone
  const now = new Date()
  const localNowStr = now.toLocaleDateString('en-CA', { timeZone: timezone })
  const targetDateHasStarted = localNowStr >= target.date

  // Format target date for display
  const formatTargetDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const formatTime = (timeStr: string) => {
    // Parse the time string (handles both ISO with Z and Iowa format)
    const utcTimeStr = timeStr.includes('Z') || timeStr.includes('+')
      ? timeStr
      : timeStr.replace(' ', 'T') + 'Z'
    const date = new Date(utcTimeStr)
    // Display in station's local timezone
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone
    })
  }

  const formatTemp = (temp: number | null) => {
    if (temp === null) return '--'
    return `${Math.round(temp)}°${target.unit}`
  }

  if (observations.length === 0) {
    const emptyMessage = !targetDateHasStarted
      ? `${formatTargetDate(target.date)} hasn't started yet in ${station.city}'s timezone`
      : `No observations available for ${formatTargetDate(target.date)}`
    return (
      <div className="analysis-observations-section">
        <div className="analysis-section-header">
          <div className="analysis-section-title">
            {formatTargetDate(target.date)} Observations ({station.icaoCode})
          </div>
        </div>
        <div className="analysis-empty">{emptyMessage}</div>
      </div>
    )
  }

  // Show only the most recent 8 observations
  const displayedObs = observations.slice(0, 8)

  return (
    <div className="analysis-observations-section">
      <div className="analysis-section-header">
        <div className="analysis-section-title">
          {formatTargetDate(target.date)} Observations ({station.icaoCode} - {station.city})
          <InfoTooltip text="Official METAR weather reports from the airport. Updates every 20-60 min. Times shown in local station time. Temp: air temperature. Dew Pt: dew point (humidity indicator). Wind: direction and speed in knots." />
        </div>
        <div className="analysis-next-update">
          Next update: <span className="analysis-countdown">{nextUpdateCountdown}</span>
        </div>
      </div>

      <div className="analysis-observations-summary">
        <div className="obs-summary-item">
          <span className="obs-summary-icon">↑</span>
          Day High: <span className="obs-summary-value">{formatTemp(highLow.observedHigh)}</span>
          {highLow.observedHigh !== null && (
            <span className="obs-summary-time">
              ({observations.find(o => o.temp === highLow.observedHigh)?.time
                ? formatTime(observations.find(o => o.temp === highLow.observedHigh)!.time)
                : '--'})
            </span>
          )}
        </div>
        <div className="obs-summary-item">
          <span className="obs-summary-icon">↓</span>
          Day Low: <span className="obs-summary-value">{formatTemp(highLow.observedLow)}</span>
          {highLow.observedLow !== null && (
            <span className="obs-summary-time">
              ({observations.find(o => o.temp === highLow.observedLow)?.time
                ? formatTime(observations.find(o => o.temp === highLow.observedLow)!.time)
                : '--'})
            </span>
          )}
        </div>
        {observations[0]?.pressure && (
          <div className="obs-summary-item">
            Pressure: <span className="obs-summary-value">{observations[0].pressure} hPa</span>
          </div>
        )}
        {observations[0]?.humidity && (
          <div className="obs-summary-item">
            Humidity: <span className="obs-summary-value">{observations[0].humidity}%</span>
          </div>
        )}
      </div>

      <div className="analysis-observations-table-wrap">
        <table className="analysis-observations-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Temp</th>
              <th>Dew Pt</th>
              <th>Wind</th>
              <th>Vis</th>
              <th>Sky</th>
            </tr>
          </thead>
          <tbody>
            {displayedObs.map((obs, idx) => (
              <tr key={idx} className="observation-row">
                <td className="obs-time">{formatTime(obs.time)}</td>
                <td className="obs-temp">{formatTemp(obs.temp)}</td>
                <td className="obs-dewpoint">{formatTemp(obs.dewPoint)}</td>
                <td className="obs-wind">{formatWindDescription(obs.wind)}</td>
                <td className="obs-visibility">{formatVisibility(obs.visibility)}</td>
                <td className="obs-sky">{obs.skyCondition || '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
