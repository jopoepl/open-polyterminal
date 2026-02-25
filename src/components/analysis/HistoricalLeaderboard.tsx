import type { ModelAccuracyRow } from '@/lib/accuracy/types'
import InfoTooltip from './InfoTooltip'

interface HistoricalLeaderboardProps {
  rows: ModelAccuracyRow[]
  unit: 'C' | 'F'
}

function formatTemp(value: number | null, unit: 'C' | 'F', signed: boolean = false): string {
  if (value === null) return '--'
  const prefix = signed && value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}°${unit}`
}

export default function HistoricalLeaderboard({ rows, unit }: HistoricalLeaderboardProps) {
  if (rows.length === 0) {
    return <div className="analysis-empty">No model ranking data available</div>
  }

  return (
    <div className="historical-leaderboard-section">
      <div className="historical-section-title">
        Model Leaderboard
        <InfoTooltip text="MAE: mean absolute error. Bias: signed average error (positive = warm). Acc: percent of days within ±2°F (or ±1°C). N: sample count. Cov: coverage versus observed days." />
      </div>
      <div className="historical-leaderboard-wrap">
      <table className="historical-leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Model</th>
            <th>MAE</th>
            <th>Bias</th>
            <th>Acc</th>
            <th>N</th>
            <th>Cov</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.model} className={!row.eligible ? 'ineligible' : ''}>
              <td>{row.rank ?? '-'}</td>
              <td className="historical-model-cell">{row.model}</td>
              <td>{formatTemp(row.mae, unit)}</td>
              <td>{formatTemp(row.bias, unit, true)}</td>
              <td>{row.accuracyPct === null ? '--' : `${row.accuracyPct.toFixed(1)}%`}</td>
              <td>{row.sampleCount}</td>
              <td>{row.coveragePct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
