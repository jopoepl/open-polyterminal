import type { Alert } from '@/types/alerts'
import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import type { MarketEvent } from '@/types'
import { generateAlertId, createExpiryTime } from '../storage'

/**
 * Forecast vs Market Mismatch Alert (High)
 * Triggers when market favorite bucket is completely outside the forecast range (min to max of all models)
 * Why range: Individual models vary - only alert when ALL models disagree with market
 * Example: All models forecast 66-72°F range, but market favorite is 60-65°F at 45%
 */
export function detectForecastMismatch(
  weatherData: WeatherAnalysisResponse,
  event: MarketEvent
): Alert | null {
  const { forecastHigh } = weatherData.highLow

  // Need forecast data from multiple models
  if (!forecastHigh || forecastHigh.length < 2) return null

  // Find the min and max forecast high across all models
  const forecasts = forecastHigh.map(f => f.value)
  const minForecast = Math.min(...forecasts)
  const maxForecast = Math.max(...forecasts)

  // Find the market favorite (highest probability bucket)
  let marketFavorite: {
    probability: number
    low: number
    high: number | null
    type: 'range' | 'above' | 'below'
    question: string
  } | null = null

  for (const outcome of event.outcomes) {
    const { target, yesPrice, question } = outcome
    if (!target || yesPrice === null) continue

    // Handle range, above, and below bucket types
    let bucketLow: number
    let bucketHigh: number | null

    if (target.type === 'range' && target.value2 !== undefined) {
      bucketLow = target.value
      bucketHigh = target.value2
    } else if (target.type === 'above') {
      bucketLow = target.value
      bucketHigh = null // No upper bound
    } else if (target.type === 'below') {
      bucketLow = -Infinity
      bucketHigh = target.value
    } else {
      continue
    }

    if (!marketFavorite || yesPrice > marketFavorite.probability) {
      marketFavorite = {
        probability: yesPrice,
        low: bucketLow,
        high: bucketHigh,
        type: target.type as 'range' | 'above' | 'below',
        question,
      }
    }
  }

  if (!marketFavorite) return null

  // Check if market favorite is completely outside forecast range
  let isMismatch = false
  let direction: 'below' | 'above' = 'below'

  if (marketFavorite.type === 'range' && marketFavorite.high !== null) {
    // Range bucket: must be entirely below min OR entirely above max
    if (marketFavorite.high < minForecast) {
      isMismatch = true
      direction = 'below'
    } else if (marketFavorite.low > maxForecast) {
      isMismatch = true
      direction = 'above'
    }
  } else if (marketFavorite.type === 'above') {
    // "Above X" bucket: mismatch if X is above all forecasts
    if (marketFavorite.low > maxForecast) {
      isMismatch = true
      direction = 'above'
    }
  } else if (marketFavorite.type === 'below' && marketFavorite.high !== null) {
    // "Below X" bucket: mismatch if X is below all forecasts
    if (marketFavorite.high < minForecast) {
      isMismatch = true
      direction = 'below'
    }
  }

  if (!isMismatch) return null

  // Only alert if market favorite has significant probability
  if (marketFavorite.probability < 0.25) return null

  const unit = weatherData.target.unit

  // Check if market is resolved (any bucket at 100%)
  const isResolved = event.outcomes.some(o => o.yesPrice !== null && o.yesPrice >= 0.99)

  // Format the bucket label
  let bucketLabel: string
  if (marketFavorite.type === 'range' && marketFavorite.high !== null) {
    bucketLabel = `${marketFavorite.low}-${marketFavorite.high}°${unit}`
  } else if (marketFavorite.type === 'above') {
    bucketLabel = `${marketFavorite.low}°${unit} or higher`
  } else {
    bucketLabel = `below ${marketFavorite.high}°${unit}`
  }

  // Adjust message for resolved markets
  const verb = isResolved ? 'forecasted' : 'forecast'
  const marketVerb = isResolved ? 'was' : 'is'

  return {
    id: generateAlertId(),
    category: 'forecast_market_mismatch',
    severity: isResolved ? 'info' : 'high',
    title: isResolved ? 'Mismatch (Resolved)' : 'Forecast/Market Mismatch',
    message: `All models ${verb} ${minForecast.toFixed(0)}-${maxForecast.toFixed(0)}°${unit}, but market favorite ${marketVerb} ${bucketLabel} at ${(marketFavorite.probability * 100).toFixed(0)}%`,
    timestamp: new Date().toISOString(),
    eventId: event.eventId,
    city: weatherData.station.city,
    targetDate: weatherData.target.date,
    data: {
      forecastMin: minForecast,
      forecastMax: maxForecast,
      marketFavoriteLow: marketFavorite.low,
      marketFavoriteHigh: marketFavorite.high,
      marketFavoriteType: marketFavorite.type,
      marketFavoriteProbability: marketFavorite.probability,
      direction,
      modelCount: forecastHigh.length,
      isResolved,
    },
    dismissed: false,
    seen: false,
    expiresAt: createExpiryTime(6), // Expires in 6 hours
  }
}
