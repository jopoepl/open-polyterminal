import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import InfoTooltip from './InfoTooltip'

interface ForecastEvolutionProps {
  data: WeatherAnalysisResponse
}

export default function ForecastEvolution({ data }: ForecastEvolutionProps) {
  const { models, target, highLow } = data

  // Get all models with daily high predictions
  const modelPredictions = models
    .filter(m => m.dailyHigh !== null)
    .map(m => ({
      name: m.name,
      high: m.dailyHigh!,
      low: m.dailyLow,
      runTime: m.runTime
    }))
    .sort((a, b) => b.high - a.high)

  if (modelPredictions.length === 0) {
    return (
      <div className="analysis-evolution-section">
        <div className="analysis-section-header">
          <div className="analysis-section-title">Model Comparison</div>
        </div>
        <div className="analysis-empty">No forecast data available</div>
      </div>
    )
  }

  const formatTemp = (temp: number | null) => {
    if (temp === null) return '--'
    return `${temp.toFixed(1)}°${target.unit}`
  }

  // Calculate spread and consensus
  const highs = modelPredictions.map(m => m.high)
  const highestPrediction = Math.max(...highs)
  const lowestPrediction = Math.min(...highs)
  const spread = highestPrediction - lowestPrediction
  const consensus = highs.reduce((a, b) => a + b, 0) / highs.length

  // Compare to observed (if we have it)
  const observedHigh = highLow.observedHigh
  const observedDiff = observedHigh !== null ? observedHigh - consensus : null

  return (
    <div className="analysis-evolution-section">
      <div className="analysis-section-header">
        <div className="analysis-section-title">
          Model Comparison
          <InfoTooltip text="Compares predictions from different weather models. Consensus: average of all models. Spread: how much models disagree (lower = more confidence). vs Consensus: how each model differs from the average." />
        </div>
      </div>

      {/* Summary Stats */}
      <div className="evolution-summary">
        <div className="evolution-stat">
          <span className="evolution-stat-label">Consensus High</span>
          <span className="evolution-stat-value">{formatTemp(consensus)}</span>
        </div>
        <div className="evolution-stat">
          <span className="evolution-stat-label">Model Spread</span>
          <span className="evolution-stat-value">±{(spread / 2).toFixed(1)}°</span>
        </div>
        {observedDiff !== null && (
          <div className="evolution-stat">
            <span className="evolution-stat-label">Observed vs Forecast</span>
            <span className={`evolution-stat-value ${observedDiff > 0 ? 'stat-warm' : observedDiff < 0 ? 'stat-cool' : ''}`}>
              {observedDiff > 0 ? '+' : ''}{observedDiff.toFixed(1)}°
            </span>
          </div>
        )}
      </div>

      {/* Model Table */}
      <div className="analysis-evolution-table-wrap">
        <table className="analysis-evolution-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Run</th>
              <th>High</th>
              <th>Low</th>
              <th>vs Consensus</th>
            </tr>
          </thead>
          <tbody>
            {modelPredictions.map(model => {
              const diff = model.high - consensus
              return (
                <tr key={model.name}>
                  <td className="evolution-model">{model.name}</td>
                  <td className="evolution-run">{model.runTime}</td>
                  <td className="evolution-high">{formatTemp(model.high)}</td>
                  <td className="evolution-low">{formatTemp(model.low)}</td>
                  <td className={`evolution-diff ${diff > 0.5 ? 'diff-warm' : diff < -0.5 ? 'diff-cool' : 'diff-neutral'}`}>
                    {diff > 0 ? '+' : ''}{diff.toFixed(1)}°
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="evolution-note">
        Historical forecast evolution requires archived data storage.
        Current view shows latest model runs only.
      </div>
    </div>
  )
}
