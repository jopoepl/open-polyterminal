import type { AlertSeverity, AlertCategory } from '@/types/alerts'

// Threshold configuration for alert detection
export const ALERT_CONFIG = {
  // Observation Threshold Alert
  observationThreshold: {
    // Market probability above which an exceeded bucket triggers alert
    mispricingThreshold: 0.30, // 30%
  },

  // Running Bias Alert
  bias: {
    // Minimum consecutive observations with same bias direction
    minConsecutive: 2,
    // Hours to ignore at start of day (local time)
    ignoreHours: [0, 1],
    // Minimum deviation to consider significant
    minDeviation: 2,
  },

  // Model Run Alerts
  modelRuns: {
    // Minutes before run to alert
    upcomingAlertMinutes: 5,
    // Minutes after availability to alert
    completedAlertMinutes: 5,
    // Models to track
    trackedModels: ['GFS', 'ECMWF'],
  },

  // Rapid Market Shift
  rapidShift: {
    // Minimum price change percentage
    minPriceChange: 0.15, // 15%
    // Time window in minutes
    timeWindowMinutes: 30,
  },

  // Resolution Imminent
  resolutionImminent: {
    // Hours before resolution to alert
    hoursThreshold: 2,
  },

  // General settings
  general: {
    // Maximum alerts to persist in storage
    maxStoredAlerts: 100,
    // Alert expiry time in hours
    defaultExpiryHours: 24,
  },
}

// Severity configurations
export const SEVERITY_CONFIG: Record<AlertSeverity, { color: string; label: string; priority: number }> = {
  critical: { color: 'var(--red)', label: 'Critical', priority: 5 },
  high: { color: '#ff9500', label: 'High', priority: 4 },
  medium: { color: 'var(--yellow)', label: 'Medium', priority: 3 },
  low: { color: 'var(--accent-2)', label: 'Low', priority: 2 },
  info: { color: 'var(--text-dim)', label: 'Info', priority: 1 },
}

// Category to default severity mapping
export const CATEGORY_SEVERITY: Record<AlertCategory, AlertSeverity> = {
  observation_threshold: 'critical',
  forecast_market_mismatch: 'high',
  running_bias: 'medium',
  model_run_upcoming: 'info',
  model_run_completed: 'medium',
  rapid_market_shift: 'high',
  resolution_imminent: 'high',
}

// Category labels for display
export const CATEGORY_LABELS: Record<AlertCategory, string> = {
  observation_threshold: 'Observation Threshold',
  forecast_market_mismatch: 'Forecast vs Market',
  running_bias: 'Running Bias',
  model_run_upcoming: 'Model Run Upcoming',
  model_run_completed: 'Model Run Complete',
  rapid_market_shift: 'Rapid Market Shift',
  resolution_imminent: 'Resolution Imminent',
}
