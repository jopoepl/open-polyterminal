import type { Alert } from '@/types/alerts'
import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import type { MarketEvent } from '@/types'
import { detectObservationThreshold } from './observationThreshold'
import { detectForecastMismatch } from './forecastMismatch'
import { detectRunningBias, clearBiasHistory } from './runningBias'
import { detectModelRuns, clearModelRunTracking } from './modelRuns'
import { ALERT_CONFIG } from '../config'
import { generateAlertId, createExpiryTime } from '../storage'

export { clearBiasHistory, clearModelRunTracking }

/**
 * Check if market is resolved (any bucket at 100%)
 */
function isMarketResolved(event: MarketEvent): boolean {
  return event.outcomes.some(o => o.yesPrice !== null && o.yesPrice >= 0.99)
}

/**
 * Run all detectors and return new alerts
 */
export function runAllDetectors(
  weatherData: WeatherAnalysisResponse,
  event: MarketEvent,
  previousPrices?: Map<string, number>
): Alert[] {
  const alerts: Alert[] = []

  // Skip all alerts for resolved markets
  if (isMarketResolved(event)) {
    return alerts
  }

  // Observation Threshold (Critical)
  const obsAlert = detectObservationThreshold(weatherData, event)
  if (obsAlert) alerts.push(obsAlert)

  // Forecast Market Mismatch (High)
  const mismatchAlert = detectForecastMismatch(weatherData, event)
  if (mismatchAlert) alerts.push(mismatchAlert)

  // Running Bias (Medium)
  const biasAlert = detectRunningBias(weatherData, event)
  if (biasAlert) alerts.push(biasAlert)

  // Model Runs (Info/Medium)
  const modelAlerts = detectModelRuns(weatherData, event)
  alerts.push(...modelAlerts)

  // Rapid Market Shift (High)
  const shiftAlert = detectRapidMarketShift(event, previousPrices)
  if (shiftAlert) {
    shiftAlert.city = weatherData.station.city
    shiftAlert.targetDate = weatherData.target.date
    alerts.push(shiftAlert)
  }

  // Resolution Imminent (High)
  const resolutionAlert = detectResolutionImminent(weatherData, event, alerts)
  if (resolutionAlert) alerts.push(resolutionAlert)

  return alerts
}

/**
 * Rapid Market Shift Alert (High)
 * Triggers when price moved >15% in 30 mins
 */
function detectRapidMarketShift(
  event: MarketEvent,
  previousPrices?: Map<string, number>
): Alert | null {
  if (!previousPrices || previousPrices.size === 0) return null

  const { minPriceChange } = ALERT_CONFIG.rapidShift
  let maxShift = 0
  let shiftOutcome: { question: string; oldPrice: number; newPrice: number } | null = null

  for (const outcome of event.outcomes) {
    if (outcome.yesPrice === null) continue

    const previousPrice = previousPrices.get(outcome.yesTokenId)
    if (previousPrice === undefined) continue

    const shift = Math.abs(outcome.yesPrice - previousPrice)
    if (shift > maxShift && shift >= minPriceChange) {
      maxShift = shift
      shiftOutcome = {
        question: outcome.question,
        oldPrice: previousPrice,
        newPrice: outcome.yesPrice,
      }
    }
  }

  if (!shiftOutcome) return null

  const direction = shiftOutcome.newPrice > shiftOutcome.oldPrice ? 'up' : 'down'

  return {
    id: generateAlertId(),
    category: 'rapid_market_shift',
    severity: 'high',
    title: 'Rapid Market Shift',
    message: `"${shiftOutcome.question}" moved ${direction} ${(maxShift * 100).toFixed(0)}% (${(shiftOutcome.oldPrice * 100).toFixed(0)}% -> ${(shiftOutcome.newPrice * 100).toFixed(0)}%)`,
    timestamp: new Date().toISOString(),
    eventId: event.eventId,
    city: '',
    targetDate: '',
    data: {
      question: shiftOutcome.question,
      oldPrice: shiftOutcome.oldPrice,
      newPrice: shiftOutcome.newPrice,
      shift: maxShift,
      direction,
    },
    dismissed: false,
    seen: false,
    expiresAt: createExpiryTime(0.5), // Expires in 30 mins
  }
}

/**
 * Resolution Imminent Alert (High)
 * Triggers when <2 hours to resolution with other active alerts
 */
function detectResolutionImminent(
  weatherData: WeatherAnalysisResponse,
  event: MarketEvent,
  activeAlerts: Alert[]
): Alert | null {
  const { hoursThreshold } = ALERT_CONFIG.resolutionImminent
  const { hoursToResolution } = weatherData.target

  // Check if within threshold
  if (hoursToResolution > hoursThreshold) return null

  // Only alert if there are other active alerts for this event
  const hasActiveAlerts = activeAlerts.some(
    a => a.eventId === event.eventId && a.category !== 'resolution_imminent'
  )

  if (!hasActiveAlerts) return null

  const alertCount = activeAlerts.filter(
    a => a.eventId === event.eventId && a.category !== 'resolution_imminent'
  ).length

  return {
    id: generateAlertId(),
    category: 'resolution_imminent',
    severity: 'high',
    title: 'Resolution Soon',
    message: `Market resolves in ${hoursToResolution < 1 ? '<1' : hoursToResolution} hour${hoursToResolution !== 1 ? 's' : ''} with ${alertCount} active alert${alertCount !== 1 ? 's' : ''}`,
    timestamp: new Date().toISOString(),
    eventId: event.eventId,
    city: weatherData.station.city,
    targetDate: weatherData.target.date,
    data: {
      hoursToResolution,
      activeAlertCount: alertCount,
    },
    dismissed: false,
    seen: false,
    expiresAt: createExpiryTime(hoursToResolution), // Expires at resolution
  }
}
