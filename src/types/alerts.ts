export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export type AlertCategory =
  | 'observation_threshold'
  | 'forecast_market_mismatch'
  | 'running_bias'
  | 'model_run_upcoming'
  | 'model_run_completed'
  | 'rapid_market_shift'
  | 'resolution_imminent'

export interface Alert {
  id: string
  category: AlertCategory
  severity: AlertSeverity
  title: string
  message: string
  timestamp: string
  eventId: string
  city: string
  targetDate: string
  data?: Record<string, unknown>
  dismissed: boolean
  seen: boolean
  expiresAt?: string
}

export interface AlertSettings {
  enabled: boolean
  desktopNotifications: boolean
}

export interface AlertState {
  alerts: Alert[]
  settings: AlertSettings
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  desktopNotifications: false
}
