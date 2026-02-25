import type { MarketOutcome } from '@/types'

/**
 * Extract unique differentiating parts from outcome questions.
 * E.g., ["Will NVIDIA be the largest?", "Will Apple be the largest?"]
 * becomes { marketId1: "NVIDIA", marketId2: "Apple" }
 */
export function extractUniqueOutcomeNames(outcomes: MarketOutcome[]): Map<string, string> {
  const questions = outcomes.map(o => o.question || '')
  const result = new Map<string, string>()

  if (questions.length <= 1) {
    outcomes.forEach(o => result.set(o.marketId, o.question || '—'))
    return result
  }

  // Find longest common prefix
  let prefix = questions[0]
  for (const q of questions) {
    while (prefix && !q.startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
    }
  }

  // Find longest common suffix
  let suffix = questions[0]
  for (const q of questions) {
    while (suffix && !q.endsWith(suffix)) {
      suffix = suffix.slice(1)
    }
  }

  // Strip common parts from each question
  for (const outcome of outcomes) {
    const q = outcome.question || ''
    let unique = q.slice(prefix.length, q.length - suffix.length).trim()

    // Clean up leftover punctuation/connectors at edges
    unique = unique.replace(/^(be\s+|the\s+)/i, '').trim()
    unique = unique.replace(/[?,.]$/g, '').trim()

    result.set(outcome.marketId, unique || q)
  }

  return result
}
