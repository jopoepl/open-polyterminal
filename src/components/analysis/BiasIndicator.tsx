import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import InfoTooltip from './InfoTooltip'

interface BiasIndicatorProps {
  data: WeatherAnalysisResponse
}

export default function BiasIndicator({ data }: BiasIndicatorProps) {
  const { bias, target } = data

  const getBiasLabel = () => {
    switch (bias.current) {
      case 'warm': return 'Running Warm'
      case 'cold': return 'Running Cold'
      default: return 'On Track'
    }
  }

  const getBiasClass = () => {
    switch (bias.current) {
      case 'warm': return 'bias-warm'
      case 'cold': return 'bias-cold'
      default: return 'bias-neutral'
    }
  }

  const formatDeviation = () => {
    if (bias.deviation === 0) return 'On target'
    const sign = bias.deviation > 0 ? '+' : ''
    return `${sign}${bias.deviation.toFixed(1)}°${target.unit} from forecast`
  }

  return (
    <div className={`analysis-bias-indicator ${getBiasClass()}`}>
      <div className="bias-header">
        <div className="bias-label">
          Today's Bias
          <InfoTooltip text="Compares latest observed temperature to model forecasts at that hour. Shows whether actual temps are running warmer or colder than predicted." />
        </div>
        <div className="bias-status">{getBiasLabel()}</div>
      </div>
      <div className="bias-detail">
        <div className="bias-deviation">{formatDeviation()}</div>
        <div className="bias-bar-container">
          <div className="bias-bar-track">
            <div className="bias-bar-cold" />
            <div className="bias-bar-neutral" />
            <div className="bias-bar-warm" />
          </div>
          <div
            className="bias-bar-indicator"
            style={{
              left: `${Math.min(100, Math.max(0, 50 + (bias.deviation * 5)))}%`
            }}
          />
        </div>
        <div className="bias-bar-labels">
          <span>Cold</span>
          <span>Neutral</span>
          <span>Warm</span>
        </div>
      </div>
    </div>
  )
}
