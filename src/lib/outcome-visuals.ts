import type { MarketOutcome } from '@/types'

export const OUTCOME_SERIES_COLORS = [
  '#39d38a',
  '#4cb4ff',
  '#f2c96d',
  '#ff6b6b',
  '#9b8cff',
  '#38bdf8',
  '#22c55e'
]

function targetSortKey(outcome: MarketOutcome) {
  const target = outcome?.target
  if (!target) return Number.MAX_SAFE_INTEGER
  if (target.type === 'range') return target.value
  return target.value
}

export function sortOutcomesForDisplay(outcomes: MarketOutcome[]) {
  return [...outcomes].sort((a, b) => {
    const diff = targetSortKey(a) - targetSortKey(b)
    if (diff !== 0) return diff
    return (a.question || '').localeCompare(b.question || '')
  })
}

export function formatOutcomeLegendLabel(outcome: MarketOutcome) {
  const target = outcome?.target
  if (!target) return outcome?.question || 'YES'

  if (target.type === 'exact') return `${target.value}°${target.unit} exact`
  if (target.type === 'range') return `${target.value}-${target.value2}°${target.unit} range`
  if (target.type === 'above') return `≥${target.value}°${target.unit} min`
  if (target.type === 'below') return `≤${target.value}°${target.unit} max`
  return outcome?.question || 'YES'
}

export function getOutcomeColorByYesToken(outcomes: MarketOutcome[]) {
  const sorted = sortOutcomesForDisplay(outcomes)
  const map: Record<string, string> = {}

  sorted.forEach((outcome, index) => {
    if (!outcome.yesTokenId) return
    map[outcome.yesTokenId] = OUTCOME_SERIES_COLORS[index % OUTCOME_SERIES_COLORS.length]
  })

  return map
}
