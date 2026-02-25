import { useEffect, useState, useCallback, useRef } from 'react'
import type { Alert, AlertSettings } from '@/types/alerts'
import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import type { MarketEvent } from '@/types'
import { DEFAULT_ALERT_SETTINGS } from '@/types/alerts'
import { loadAlerts, saveAlerts, loadSettings, saveSettings } from '@/lib/alerts/storage'
import { runAllDetectors, clearBiasHistory, clearModelRunTracking } from '@/lib/alerts/detectors'
import { SEVERITY_CONFIG } from '@/lib/alerts/config'

export interface AlertMonitorTarget {
  event: MarketEvent
  city: string
  targetDate: string
  unit: 'C' | 'F'
}

export interface NextModelRunInfo {
  eventId: string
  city: string
  targetDate: string
  model: string
  nextRun: string
  nextRunAt: string
  minutesUntilNext: number
}

export interface AlertScanStatus {
  totalMarkets: number
  scannedMarkets: number
  lastScanAt: string | null
}

interface UseAlertEngineOptions {
  monitorTargets: AlertMonitorTarget[]
  scanIntervalMs?: number
}

interface UseAlertEngineResult {
  alerts: Alert[]
  settings: AlertSettings
  unreadCount: number
  nextModelRun: NextModelRunInfo | null
  scanStatus: AlertScanStatus
  dismissAlert: (id: string) => void
  dismissAllForEvent: (eventId: string) => void
  clearAllAlerts: () => void
  markAllSeen: () => void
  toggleEnabled: () => void
  toggleDesktopNotifications: () => void
}

const DEFAULT_SCAN_INTERVAL_MS = 6000
type ModelUpdate = WeatherAnalysisResponse['modelUpdates'][number]

function parseFutureIso(value: string | undefined, nowMs: number): number | null {
  if (!value || !/\d{4}-\d{2}-\d{2}/.test(value)) return null
  const ts = Date.parse(value)
  if (!Number.isFinite(ts) || ts <= nowMs) return null
  return ts
}

function resolveNextRunAt(update: ModelUpdate, nowMs: number): string | null {
  const absoluteTs =
    parseFutureIso(update.nextRunAt, nowMs)
    ?? parseFutureIso(update.nextRun, nowMs)

  if (absoluteTs !== null) {
    return new Date(absoluteTs).toISOString()
  }

  if (update.minutesUntilNext > 0) {
    return new Date(nowMs + update.minutesUntilNext * 60 * 1000).toISOString()
  }

  return null
}

function isResolvedEvent(event: MarketEvent): boolean {
  return event.outcomes.some(outcome => outcome.yesPrice !== null && outcome.yesPrice >= 0.99)
}

function parseAlertData(alert: Alert): Record<string, unknown> {
  if (!alert.data || typeof alert.data !== 'object') return {}
  return alert.data
}

function readPart(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return ''
}

function readNumber(value: unknown, digits: number = 3): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return value.toFixed(digits)
}

function buildAlertKey(alert: Alert): string {
  const data = parseAlertData(alert)
  const base = `${alert.eventId}:${alert.category}`

  switch (alert.category) {
    case 'observation_threshold':
      return `${base}:${readPart(data.bucketLabel)}`
    case 'forecast_market_mismatch':
      return `${base}:${readPart(data.marketFavoriteType)}:${readNumber(data.minForecast, 1)}:${readNumber(data.maxForecast, 1)}:${readNumber(data.marketFavoriteLow, 1)}:${readNumber(data.marketFavoriteHigh, 1)}`
    case 'running_bias':
      return `${base}:${readPart(data.biasDirection)}:${readPart(data.consecutiveCount)}`
    case 'model_run_upcoming':
      return `${base}:${readPart(data.model)}:${readPart(data.nextRun)}`
    case 'model_run_completed':
      return `${base}:${readPart(data.model)}:${readPart(data.lastRun)}`
    case 'rapid_market_shift':
      return `${base}:${readPart(data.question)}:${readNumber(data.oldPrice)}:${readNumber(data.newPrice)}:${readPart(data.direction)}`
    case 'resolution_imminent':
      return base
    default:
      return `${base}:${alert.message}`
  }
}

function readAlertKey(alert: Alert): string {
  const data = parseAlertData(alert)
  if (typeof data.alertKey === 'string' && data.alertKey.length > 0) {
    return data.alertKey
  }
  return buildAlertKey(alert)
}

function withAlertKey(alert: Alert, key: string): Alert {
  const data = parseAlertData(alert)
  return {
    ...alert,
    data: {
      ...data,
      alertKey: key,
    },
  }
}

function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const tsB = Date.parse(b.timestamp)
    const tsA = Date.parse(a.timestamp)
    const normalizedB = Number.isFinite(tsB) ? tsB : 0
    const normalizedA = Number.isFinite(tsA) ? tsA : 0
    if (normalizedB !== normalizedA) return normalizedB - normalizedA

    // Keep deterministic ordering when timestamps match.
    const severityDiff = SEVERITY_CONFIG[b.severity].priority - SEVERITY_CONFIG[a.severity].priority
    if (severityDiff !== 0) return severityDiff
    return b.id.localeCompare(a.id)
  })
}

function pickPreferredAlert(existing: Alert, candidate: Alert): Alert {
  if (existing.dismissed !== candidate.dismissed) {
    return candidate.dismissed ? candidate : existing
  }

  const existingTs = new Date(existing.timestamp).getTime()
  const candidateTs = new Date(candidate.timestamp).getTime()
  return candidateTs > existingTs ? candidate : existing
}

function dedupeAlerts(alerts: Alert[]): Alert[] {
  const now = new Date().toISOString()
  const byKey = new Map<string, Alert>()

  for (const alert of alerts) {
    if (alert.expiresAt && alert.expiresAt <= now) continue
    const key = readAlertKey(alert)
    const keyedAlert = withAlertKey(alert, key)
    const existing = byKey.get(key)
    byKey.set(key, existing ? pickPreferredAlert(existing, keyedAlert) : keyedAlert)
  }

  return sortAlerts(Array.from(byKey.values()))
}

function sendNotification(alert: Alert, alertKey: string): void {
  try {
    new Notification(`PolyTerminal: ${alert.title}`, {
      body: alert.message,
      icon: '/favicon.ico',
      tag: `poly-alert-${alertKey}`,
    })
  } catch {
    // Notifications not supported or blocked
  }
}

export function useAlertEngine({
  monitorTargets,
  scanIntervalMs = DEFAULT_SCAN_INTERVAL_MS,
}: UseAlertEngineOptions): UseAlertEngineResult {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS)
  const [nextModelRun, setNextModelRun] = useState<NextModelRunInfo | null>(null)
  const [scanStatus, setScanStatus] = useState<AlertScanStatus>({
    totalMarkets: 0,
    scannedMarkets: 0,
    lastScanAt: null,
  })

  const initializedRef = useRef(false)
  const scanIndexRef = useRef(0)
  const scanInFlightRef = useRef(false)
  const previousPricesByEventRef = useRef<Map<string, Map<string, number>>>(new Map())
  const scannedEventIdsRef = useRef<Set<string>>(new Set())
  const nextModelRunCandidatesRef = useRef<Map<string, NextModelRunInfo>>(new Map())

  const clearEventTracking = useCallback((eventId: string) => {
    previousPricesByEventRef.current.delete(eventId)
    clearBiasHistory(eventId)
    clearModelRunTracking(eventId)

    for (const key of nextModelRunCandidatesRef.current.keys()) {
      if (key.startsWith(`${eventId}:`)) {
        nextModelRunCandidatesRef.current.delete(key)
      }
    }
  }, [])

  const recomputeNextModelRun = useCallback(() => {
    const now = Date.now()
    let best: NextModelRunInfo | null = null
    let bestTs = Number.POSITIVE_INFINITY

    for (const candidate of nextModelRunCandidatesRef.current.values()) {
      const nextRunTs = Date.parse(candidate.nextRunAt)
      if (!Number.isFinite(nextRunTs) || nextRunTs <= now) continue
      if (nextRunTs < bestTs) {
        bestTs = nextRunTs
        best = candidate
      }
    }

    setNextModelRun(best)
  }, [])

  const updateNextModelRunCandidates = useCallback((
    target: AlertMonitorTarget,
    weatherData: WeatherAnalysisResponse
  ) => {
    const seenKeys = new Set<string>()
    const now = Date.now()

    for (const update of weatherData.modelUpdates) {
      const key = `${target.event.eventId}:${update.model}`
      seenKeys.add(key)

      const nextRunAt = resolveNextRunAt(update, now)
      if (!nextRunAt) {
        nextModelRunCandidatesRef.current.delete(key)
        continue
      }

      nextModelRunCandidatesRef.current.set(key, {
        eventId: target.event.eventId,
        city: target.city,
        targetDate: target.targetDate,
        model: update.model,
        nextRun: update.nextRun,
        nextRunAt,
        minutesUntilNext: update.minutesUntilNext,
      })
    }

    for (const key of nextModelRunCandidatesRef.current.keys()) {
      if (key.startsWith(`${target.event.eventId}:`) && !seenKeys.has(key)) {
        nextModelRunCandidatesRef.current.delete(key)
      }
    }

    recomputeNextModelRun()
  }, [recomputeNextModelRun])

  const processAlertsForTarget = useCallback((
    target: AlertMonitorTarget,
    weatherData: WeatherAnalysisResponse
  ) => {
    const { event } = target
    const eventId = event.eventId

    if (isResolvedEvent(event)) {
      setAlerts(prev => prev.map(alert => (
        alert.eventId === eventId ? { ...alert, dismissed: true } : alert
      )))
      clearEventTracking(eventId)
      return
    }

    const previousPrices = previousPricesByEventRef.current.get(eventId)
    const newAlerts = runAllDetectors(weatherData, event, previousPrices)

    const nextPrices = new Map<string, number>()
    for (const outcome of event.outcomes) {
      if (outcome.yesPrice !== null) {
        nextPrices.set(outcome.yesTokenId, outcome.yesPrice)
      }
    }
    previousPricesByEventRef.current.set(eventId, nextPrices)

    if (newAlerts.length === 0) return

    setAlerts(prev => {
      const deduped = dedupeAlerts(prev)
      const keys = new Set(deduped.map(readAlertKey))
      const next = [...deduped]

      for (const alert of newAlerts) {
        const key = buildAlertKey(alert)
        if (keys.has(key)) continue

        const keyedAlert = withAlertKey(alert, key)
        keys.add(key)
        next.push(keyedAlert)

        if (settings.desktopNotifications && Notification.permission === 'granted') {
          sendNotification(keyedAlert, key)
        }
      }

      return dedupeAlerts(next)
    })
  }, [clearEventTracking, settings.desktopNotifications])

  // Load from localStorage on mount
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    setAlerts(dedupeAlerts(loadAlerts()))
    setSettings(loadSettings())
  }, [])

  // Save alerts to localStorage when they change
  useEffect(() => {
    if (!initializedRef.current) return
    saveAlerts(alerts)
  }, [alerts])

  // Save settings to localStorage when they change
  useEffect(() => {
    if (!initializedRef.current) return
    saveSettings(settings)
  }, [settings])

  // Keep monitor-tracking state aligned to currently monitored markets
  useEffect(() => {
    const currentEventIds = new Set(monitorTargets.map(target => target.event.eventId))

    for (const eventId of Array.from(scannedEventIdsRef.current)) {
      if (!currentEventIds.has(eventId)) scannedEventIdsRef.current.delete(eventId)
    }

    for (const eventId of previousPricesByEventRef.current.keys()) {
      if (!currentEventIds.has(eventId)) clearEventTracking(eventId)
    }

    const resolvedIds = new Set(
      monitorTargets
        .filter(target => isResolvedEvent(target.event))
        .map(target => target.event.eventId)
    )

    if (resolvedIds.size > 0) {
      setAlerts(prev => dedupeAlerts(prev.map(alert => (
        resolvedIds.has(alert.eventId) ? { ...alert, dismissed: true } : alert
      ))))

      for (const eventId of resolvedIds) {
        clearEventTracking(eventId)
      }
    }

    setScanStatus(prev => ({
      totalMarkets: monitorTargets.length,
      scannedMarkets: scannedEventIdsRef.current.size,
      lastScanAt: prev.lastScanAt,
    }))

    if (monitorTargets.length > 0) {
      scanIndexRef.current = scanIndexRef.current % monitorTargets.length
    } else {
      scanIndexRef.current = 0
      setNextModelRun(null)
    }

    recomputeNextModelRun()
  }, [monitorTargets, clearEventTracking, recomputeNextModelRun])

  // Round-robin scan across all monitor targets
  useEffect(() => {
    if (!settings.enabled) return
    if (monitorTargets.length === 0) return

    let cancelled = false

    const scanNext = async () => {
      if (cancelled || scanInFlightRef.current || monitorTargets.length === 0) return

      const target = monitorTargets[scanIndexRef.current % monitorTargets.length]
      scanIndexRef.current = (scanIndexRef.current + 1) % monitorTargets.length

      if (isResolvedEvent(target.event)) {
        clearEventTracking(target.event.eventId)
        return
      }

      scanInFlightRef.current = true
      try {
        const params = new URLSearchParams({
          city: target.city,
          date: target.targetDate,
          unit: target.unit,
        })

        const response = await fetch(`/api/weather-analysis?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) return
        const weatherData = await response.json() as WeatherAnalysisResponse
        if (cancelled) return

        updateNextModelRunCandidates(target, weatherData)
        processAlertsForTarget(target, weatherData)

        scannedEventIdsRef.current.add(target.event.eventId)
        setScanStatus({
          totalMarkets: monitorTargets.length,
          scannedMarkets: scannedEventIdsRef.current.size,
          lastScanAt: new Date().toISOString(),
        })
      } catch {
        // Continue scanning next target
      } finally {
        scanInFlightRef.current = false
      }
    }

    void scanNext()
    const interval = setInterval(() => {
      void scanNext()
    }, scanIntervalMs)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [
    settings.enabled,
    monitorTargets,
    scanIntervalMs,
    clearEventTracking,
    processAlertsForTarget,
    updateNextModelRunCandidates,
  ])

  const dismissAlert = useCallback((id: string) => {
    setAlerts(prev => dedupeAlerts(prev.map(alert => (
      alert.id === id ? { ...alert, dismissed: true } : alert
    ))))
  }, [])

  const dismissAllForEvent = useCallback((eventId: string) => {
    setAlerts(prev => dedupeAlerts(prev.map(alert => (
      alert.eventId === eventId ? { ...alert, dismissed: true } : alert
    ))))
  }, [])

  const clearAllAlerts = useCallback(() => {
    setAlerts([])
  }, [])

  const markAllSeen = useCallback(() => {
    setAlerts(prev => dedupeAlerts(prev.map(alert => ({ ...alert, seen: true }))))
  }, [])

  const toggleEnabled = useCallback(() => {
    setSettings(prev => ({ ...prev, enabled: !prev.enabled }))
  }, [])

  const toggleDesktopNotifications = useCallback(async () => {
    if (!settings.desktopNotifications) {
      if ('Notification' in window) {
        const permission = await Notification.requestPermission()
        if (permission === 'granted') {
          setSettings(prev => ({ ...prev, desktopNotifications: true }))
        }
      }
      return
    }

    setSettings(prev => ({ ...prev, desktopNotifications: false }))
  }, [settings.desktopNotifications])

  const unreadCount = alerts.filter(alert => !alert.dismissed && !alert.seen).length
  const activeAlerts = alerts.filter(alert => !alert.dismissed)

  return {
    alerts: activeAlerts,
    settings,
    unreadCount,
    nextModelRun,
    scanStatus,
    dismissAlert,
    dismissAllForEvent,
    clearAllAlerts,
    markAllSeen,
    toggleEnabled,
    toggleDesktopNotifications,
  }
}
