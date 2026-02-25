import type { Alert, AlertSettings, AlertState } from '@/types/alerts'
import { DEFAULT_ALERT_SETTINGS } from '@/types/alerts'
import { ALERT_CONFIG } from './config'

const ALERTS_STORAGE_KEY = 'poly-terminal-alerts'
const SETTINGS_STORAGE_KEY = 'poly-terminal-alert-settings'

export function loadAlerts(): Alert[] {
  if (typeof window === 'undefined') return []

  try {
    const stored = window.localStorage.getItem(ALERTS_STORAGE_KEY)
    if (!stored) return []

    const parsed = JSON.parse(stored) as Alert[]

    // Filter out expired alerts
    const now = new Date().toISOString()
    return parsed.filter(alert => !alert.expiresAt || alert.expiresAt > now)
  } catch {
    return []
  }
}

export function saveAlerts(alerts: Alert[]): void {
  if (typeof window === 'undefined') return

  try {
    // Limit to max stored alerts
    const trimmed = alerts.slice(0, ALERT_CONFIG.general.maxStoredAlerts)
    window.localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // Storage might be full or disabled
  }
}

export function loadSettings(): AlertSettings {
  if (typeof window === 'undefined') return DEFAULT_ALERT_SETTINGS

  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!stored) return DEFAULT_ALERT_SETTINGS

    const parsed = JSON.parse(stored) as AlertSettings
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      desktopNotifications: typeof parsed.desktopNotifications === 'boolean' ? parsed.desktopNotifications : false,
    }
  } catch {
    return DEFAULT_ALERT_SETTINGS
  }
}

export function saveSettings(settings: AlertSettings): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage might be full or disabled
  }
}

export function loadAlertState(): AlertState {
  return {
    alerts: loadAlerts(),
    settings: loadSettings(),
  }
}

export function generateAlertId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createExpiryTime(hours: number = ALERT_CONFIG.general.defaultExpiryHours): string {
  const expiry = new Date()
  expiry.setHours(expiry.getHours() + hours)
  return expiry.toISOString()
}
