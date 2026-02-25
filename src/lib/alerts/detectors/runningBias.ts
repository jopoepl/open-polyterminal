import type { Alert } from '@/types/alerts'
import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import type { MarketEvent } from '@/types'
import { ALERT_CONFIG } from '../config'
import { generateAlertId, createExpiryTime } from '../storage'

/**
 * Running Bias Alert (Medium)
 * Triggers when 2+ consecutive observations have same bias direction (warm/cold)
 * Analyzes existing observations in weather data to detect consistent bias pattern
 * Skips early morning hours (midnight, 1am local time)
 */
export function detectRunningBias(
  weatherData: WeatherAnalysisResponse,
  event: MarketEvent
): Alert | null {
  const { bias, observations, station, highLow, models } = weatherData
  const { minConsecutive, ignoreHours, minDeviation } = ALERT_CONFIG.bias

  // Need observations and model forecasts to calculate bias
  if (!observations || observations.length < minConsecutive) return null
  if (!models || models.length === 0) return null

  const unit = weatherData.target.unit

  // Build a map of forecast temps by hour from models
  const forecastByHour: Map<number, number[]> = new Map()
  for (const model of models) {
    for (const hourly of model.hourlyTemps) {
      const match = hourly.time.match(/T(\d{2}):/)
      if (match) {
        const hour = parseInt(match[1])
        const temps = forecastByHour.get(hour) || []
        temps.push(hourly.temp)
        forecastByHour.set(hour, temps)
      }
    }
  }

  // Analyze observations to find bias direction for each
  type BiasEntry = {
    localHour: number
    observedTemp: number
    forecastTemp: number
    deviation: number
    direction: 'warm' | 'cold' | 'neutral'
  }

  const biasEntries: BiasEntry[] = []

  for (const obs of observations) {
    if (obs.temp === null) continue

    // Parse observation time
    let obsTime: Date
    try {
      const timeStr = obs.time.includes('Z') || obs.time.includes('+')
        ? obs.time
        : obs.time.replace(' ', 'T') + 'Z'
      obsTime = new Date(timeStr)
    } catch {
      continue
    }

    // Get local hour for filtering
    let localHour = 0
    try {
      localHour = parseInt(
        obsTime.toLocaleString('en-US', {
          timeZone: station.timezone,
          hour: 'numeric',
          hour12: false,
        })
      )
    } catch {
      continue
    }

    // Skip early morning hours
    if (ignoreHours.includes(localHour)) continue

    // Match forecast on local hour (Open-Meteo timezone=auto returns local timestamps).
    // Using UTC here can invert/overstate the bias overnight.
    const forecastTemps = forecastByHour.get(localHour)
    if (!forecastTemps || forecastTemps.length === 0) continue

    const avgForecast = forecastTemps.reduce((a, b) => a + b, 0) / forecastTemps.length
    const deviation = obs.temp - avgForecast

    let direction: 'warm' | 'cold' | 'neutral' = 'neutral'
    if (deviation >= minDeviation) direction = 'warm'
    else if (deviation <= -minDeviation) direction = 'cold'

    biasEntries.push({
      localHour,
      observedTemp: obs.temp,
      forecastTemp: avgForecast,
      deviation,
      direction,
    })
  }

  // Sort by time (observations are usually newest first, we want oldest first)
  biasEntries.reverse()

  // Find consecutive runs of same bias direction
  let maxConsecutive = 0
  let currentRun = 0
  let runDirection: 'warm' | 'cold' | 'neutral' = 'neutral'
  let totalDeviation = 0

  for (const entry of biasEntries) {
    if (entry.direction === 'neutral') {
      // Neutral breaks the run
      if (currentRun > maxConsecutive) {
        maxConsecutive = currentRun
      }
      currentRun = 0
      totalDeviation = 0
      runDirection = 'neutral'
    } else if (runDirection === 'neutral' || runDirection === entry.direction) {
      // Start or continue a run
      runDirection = entry.direction
      currentRun++
      totalDeviation += entry.deviation
    } else {
      // Direction changed - save previous run and start new
      if (currentRun > maxConsecutive) {
        maxConsecutive = currentRun
      }
      runDirection = entry.direction
      currentRun = 1
      totalDeviation = entry.deviation
    }
  }

  // Check final run
  if (currentRun >= minConsecutive && runDirection !== 'neutral') {
    const avgDeviation = totalDeviation / currentRun

    // Check if observed high is outside forecast range
    const { observedHigh, forecastHigh } = highLow
    let outsideForecastRange = false
    let forecastRange = ''

    if (observedHigh !== null && forecastHigh.length > 0) {
      const forecasts = forecastHigh.map(f => f.value)
      const minForecast = Math.min(...forecasts)
      const maxForecast = Math.max(...forecasts)
      forecastRange = `${minForecast.toFixed(0)}-${maxForecast.toFixed(0)}°${unit}`

      if (observedHigh < minForecast || observedHigh > maxForecast) {
        outsideForecastRange = true
      }
    }

    const directionLabel = runDirection === 'warm' ? 'warmer' : 'colder'
    let message = `${currentRun} consecutive observations running ${directionLabel} (avg ${avgDeviation > 0 ? '+' : ''}${avgDeviation.toFixed(1)}°${unit})`
    if (outsideForecastRange && forecastRange) {
      message += ` - outside forecast range ${forecastRange}`
    }

    return {
      id: generateAlertId(),
      category: 'running_bias',
      severity: 'medium',
      title: `Running ${runDirection === 'warm' ? 'Warm' : 'Cold'} Bias`,
      message,
      timestamp: new Date().toISOString(),
      eventId: event.eventId,
      city: station.city,
      targetDate: weatherData.target.date,
      data: {
        biasDirection: runDirection,
        consecutiveCount: currentRun,
        avgDeviation,
        outsideForecastRange,
        currentBias: bias.current,
        currentDeviation: bias.deviation,
      },
      dismissed: false,
      seen: false,
      expiresAt: createExpiryTime(1),
    }
  }

  return null
}

// No longer needed - we analyze observations directly now
export function clearBiasHistory(_eventId: string): void {
  // No-op for backwards compatibility
}
