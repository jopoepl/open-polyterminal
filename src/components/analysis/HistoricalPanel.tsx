import { useMemo, useState } from 'react'
import { extractCityFromText } from '@/lib/weather/stations'
import { useHistoricalAccuracy } from '@/hooks/useHistoricalAccuracy'
import type { HistoricalPeriod } from '@/lib/accuracy/types'
import type { MarketEvent } from '@/types'
import HistoricalPeriodSelector from './HistoricalPeriodSelector'
import HistoricalLeaderboard from './HistoricalLeaderboard'
import HistoricalChart from './HistoricalChart'
import HistoricalHourlyDrift from './HistoricalHourlyDrift'
import InfoTooltip from './InfoTooltip'

interface HistoricalPanelProps {
  selectedEvent: MarketEvent | null
  theme: 'dark' | 'light'
}

function getUnitFromEvent(event: MarketEvent): 'C' | 'F' {
  for (const outcome of event.outcomes) {
    if (outcome.target?.unit === 'C') return 'C'
  }
  return 'F'
}

export default function HistoricalPanel({ selectedEvent, theme }: HistoricalPanelProps) {
  const [period, setPeriod] = useState<HistoricalPeriod>('1w')
  const scoringMode = 'day_ahead' as const

  const parsed = useMemo(() => {
    if (!selectedEvent || selectedEvent.category !== 'weather') return null
    const city = extractCityFromText(selectedEvent.title)
    if (!city) return null
    return {
      city,
      unit: getUnitFromEvent(selectedEvent),
    }
  }, [selectedEvent])

  const historical = useHistoricalAccuracy({
    city: parsed?.city ?? null,
    unit: parsed?.unit ?? 'F',
    period,
    scoringMode,
    enabled: !!parsed,
  })

  if (!selectedEvent) {
    return <div className="empty-state">Select a market to view historical accuracy</div>
  }

  if (selectedEvent.category !== 'weather') {
    return <div className="data-panel-placeholder"><div className="data-placeholder-title">Historical weather accuracy is only available for weather markets</div></div>
  }

  if (!parsed) {
    return <div className="data-panel-placeholder"><div className="data-placeholder-title">Unable to resolve city for this market</div></div>
  }

  return (
    <div className="historical-panel">
      <div className="analysis-section-header">
        <div className="analysis-section-title">
          Historical Model Accuracy ({parsed.city})
          <InfoTooltip text="Observed peaks are daily METAR highs. Forecast peaks are T-1 peaks: the previous local day forecast value for each target day." />
        </div>
        <div className="historical-controls">
          <HistoricalPeriodSelector value={period} onChange={setPeriod} disabled={historical.loading} />
        </div>
      </div>
      <div className="tab-beta-disclaimer">
        Beta: still building. Verify independently before making decisions; it can make mistakes.
      </div>

      {historical.loading && !historical.data && (
        <div className="analysis-dashboard-loading">Loading historical accuracy...</div>
      )}

      {historical.error && !historical.data && (
        <div className="data-panel-placeholder">
          <div className="data-placeholder-title">Failed to load historical accuracy</div>
          <div className="data-placeholder-text">{historical.error.message}</div>
        </div>
      )}

      {historical.data && (
        <>
          <div className="historical-summary-row">
            <div className="historical-summary-item">
              <div className="historical-summary-label">Window</div>
              <div>{historical.data.period.start} to {historical.data.period.end}</div>
            </div>
            <div className="historical-summary-item">
              <div className="historical-summary-label">Best Model</div>
              <div>
                {historical.data.bestModel
                  ? `${historical.data.bestModel.name} (${historical.data.bestModel.mae.toFixed(1)}°${parsed.unit} MAE)`
                  : 'Insufficient coverage'}
              </div>
            </div>
            <div className="historical-summary-item">
              <div className="historical-summary-label">Scoring</div>
              <div>Day-ahead (strict +24h lead)</div>
            </div>
            <div className="historical-summary-item">
              <div className="historical-summary-label">Observed Station</div>
              <div>{historical.data.station.icaoCode} (METAR)</div>
            </div>
            <button className="btn historical-refresh-btn" onClick={historical.refresh} disabled={historical.loading}>
              Refresh
            </button>
          </div>

          {historical.data.warnings.length > 0 && (
            <div className="historical-warning-list">
              {historical.data.warnings.map((warning, index) => (
                <div key={index} className="historical-warning-item">{warning}</div>
              ))}
            </div>
          )}

          <div className="historical-divider" />

          <HistoricalChart
            dailySeries={historical.data.dailySeries}
            rankings={historical.data.modelAccuracy}
            theme={theme}
          />

          <div className="historical-divider" />

          <HistoricalHourlyDrift
            hourly={historical.data.hourly}
            rankings={historical.data.modelAccuracy}
            unit={parsed.unit}
            theme={theme}
          />

          <div className="historical-divider" />

          <HistoricalLeaderboard rows={historical.data.modelAccuracy} unit={parsed.unit} />
        </>
      )}
    </div>
  )
}
