import type { Alert } from '@/types/alerts'
import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import type { MarketEvent } from '@/types'
import { ALERT_CONFIG } from '../config'
import { generateAlertId, createExpiryTime } from '../storage'

// Track last known model run times
const lastKnownRuns: Map<string, string> = new Map()

/**
 * Model Run Alerts (Info -> Medium)
 * - Upcoming: Alert 5 mins before GFS/ECMWF run
 * - Completed: Alert when new run available (detect lastRun change)
 */
export function detectModelRuns(
  weatherData: WeatherAnalysisResponse,
  event: MarketEvent
): Alert[] {
  const { modelUpdates, station } = weatherData
  const { upcomingAlertMinutes, completedAlertMinutes, trackedModels } = ALERT_CONFIG.modelRuns

  const alerts: Alert[] = []

  for (const update of modelUpdates) {
    // Only track specified models
    if (!trackedModels.includes(update.model)) continue

    const modelKey = `${event.eventId}-${update.model}`
    const previousRun = lastKnownRuns.get(modelKey)

    // Check for upcoming run
    if (update.minutesUntilNext <= upcomingAlertMinutes && update.minutesUntilNext > 0) {
      alerts.push({
        id: generateAlertId(),
        category: 'model_run_upcoming',
        severity: 'info',
        title: `${update.model} Run Soon`,
        message: `${update.model} model run expected in ~${update.minutesUntilNext} min (${update.nextRun})`,
        timestamp: new Date().toISOString(),
        eventId: event.eventId,
        city: station.city,
        targetDate: weatherData.target.date,
        data: {
          model: update.model,
          nextRun: update.nextRun,
          minutesUntilNext: update.minutesUntilNext,
        },
        dismissed: false,
        seen: false,
        expiresAt: createExpiryTime(0.25), // Expires in 15 mins
      })
    }

    // Check for completed run (new data available)
    if (previousRun && previousRun !== update.lastRun) {
      // New run detected - check if it's recent enough to alert
      const dataAgeMinutes = update.dataAgeMinutes || 0

      if (dataAgeMinutes <= completedAlertMinutes) {
        alerts.push({
          id: generateAlertId(),
          category: 'model_run_completed',
          severity: 'medium',
          title: `${update.model} Run Complete`,
          message: `New ${update.model} ${update.lastRun} run now available`,
          timestamp: new Date().toISOString(),
          eventId: event.eventId,
          city: station.city,
          targetDate: weatherData.target.date,
          data: {
            model: update.model,
            lastRun: update.lastRun,
            previousRun,
            dataAgeMinutes,
          },
          dismissed: false,
          seen: false,
          expiresAt: createExpiryTime(1), // Expires in 1 hour
        })
      }
    }

    // Update tracked run
    lastKnownRuns.set(modelKey, update.lastRun)
  }

  return alerts
}

// Clear model run tracking for an event
export function clearModelRunTracking(eventId: string): void {
  for (const key of lastKnownRuns.keys()) {
    if (key.startsWith(eventId)) {
      lastKnownRuns.delete(key)
    }
  }
}
