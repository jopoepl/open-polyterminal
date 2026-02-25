import type { Alert } from '@/types/alerts'
import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import type { MarketEvent } from '@/types'
import { ALERT_CONFIG } from '../config'
import { generateAlertId, createExpiryTime } from '../storage'

/**
 * Observation Threshold Alert (Critical)
 * Triggers when observed temp has passed a bucket's threshold but that bucket still shows >30% probability
 * Example: Observed high is 72°F but "65-70°F" bucket still at 40%
 */
export function detectObservationThreshold(
  weatherData: WeatherAnalysisResponse,
  event: MarketEvent
): Alert | null {
  const { observedHigh } = weatherData.highLow
  const { mispricingThreshold } = ALERT_CONFIG.observationThreshold

  // Need observed high to detect threshold breach
  if (observedHigh === null) return null

  // Find buckets that have been exceeded but still have high probability
  const exceededBuckets: Array<{
    bucketLabel: string
    probability: number
    bucketType: string
  }> = []

  const unit = weatherData.target.unit

  for (const outcome of event.outcomes) {
    const { target, yesPrice } = outcome
    if (!target || yesPrice === null) continue

    // Check if this bucket has been exceeded by observed high
    let isExceeded = false
    let bucketLabel = ''

    if (target.type === 'range' && target.value2 !== undefined) {
      // For range buckets: exceeded if observed high is above the upper bound
      isExceeded = observedHigh > target.value2
      bucketLabel = `${target.value}-${target.value2}°${unit}`
    } else if (target.type === 'below') {
      // For "below X" buckets: exceeded if observed high is at or above threshold
      isExceeded = observedHigh >= target.value
      bucketLabel = `below ${target.value}°${unit}`
    }
    // Note: "above X" buckets can never be "exceeded" - they have no upper limit

    // If exceeded and still has significant probability
    if (isExceeded && yesPrice > mispricingThreshold) {
      exceededBuckets.push({
        bucketLabel,
        probability: yesPrice,
        bucketType: target.type,
      })
    }
  }

  // Return alert for the highest probability exceeded bucket
  if (exceededBuckets.length === 0) return null

  exceededBuckets.sort((a, b) => b.probability - a.probability)
  const worst = exceededBuckets[0]

  // Check if market is resolved
  const isResolved = event.outcomes.some(o => o.yesPrice !== null && o.yesPrice >= 0.99)

  return {
    id: generateAlertId(),
    category: 'observation_threshold',
    severity: isResolved ? 'info' : 'critical',
    title: isResolved ? 'Threshold Exceeded (Resolved)' : 'Threshold Exceeded',
    message: isResolved
      ? `Observed high was ${observedHigh}°${unit} but "${worst.bucketLabel}" bucket was at ${(worst.probability * 100).toFixed(0)}%`
      : `Observed high is ${observedHigh}°${unit} but "${worst.bucketLabel}" bucket still at ${(worst.probability * 100).toFixed(0)}%`,
    timestamp: new Date().toISOString(),
    eventId: event.eventId,
    city: weatherData.station.city,
    targetDate: weatherData.target.date,
    data: {
      observedHigh,
      bucketLabel: worst.bucketLabel,
      probability: worst.probability,
      isResolved,
    },
    dismissed: false,
    seen: false,
    expiresAt: createExpiryTime(2), // Expires in 2 hours
  }
}
