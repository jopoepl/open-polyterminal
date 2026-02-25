import type { HistoricalPeriod } from '@/lib/accuracy/types'

interface HistoricalPeriodSelectorProps {
  value: HistoricalPeriod
  onChange: (period: HistoricalPeriod) => void
  disabled?: boolean
}

const PERIOD_OPTIONS: Array<{ value: HistoricalPeriod; label: string }> = [
  { value: '3d', label: '3D' },
  { value: '5d', label: '5D' },
  { value: '1w', label: '7D' },
  { value: '10d', label: '10D' },
  { value: '15d', label: '15D' },
  { value: '1m', label: '30D' },
]

export default function HistoricalPeriodSelector({
  value,
  onChange,
  disabled = false,
}: HistoricalPeriodSelectorProps) {
  return (
    <div className="historical-period-selector">
      {PERIOD_OPTIONS.map(option => (
        <button
          key={option.value}
          className={`historical-period-btn ${value === option.value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
          disabled={disabled}
          title={`Show ${option.label} window`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
