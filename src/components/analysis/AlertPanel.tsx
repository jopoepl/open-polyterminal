import { useEffect, useState } from 'react'
import type { Alert, AlertSettings } from '@/types/alerts'
import type { AlertScanStatus, NextModelRunInfo } from '@/hooks/useAlertEngine'
import { AlertItem } from './AlertItem'

interface AlertPanelProps {
  alerts: Alert[]
  settings: AlertSettings
  nextModelRun: NextModelRunInfo | null
  scanStatus: AlertScanStatus
  onDismiss: (id: string) => void
  onDismissAll: () => void
  onToggleEnabled: () => void
  onToggleDesktopNotifications: () => void
  onMarkAllSeen: () => void
}

function formatCountdown(targetIso: string | null, nowMs: number): string {
  if (!targetIso) return '--'
  const targetMs = Date.parse(targetIso)
  if (!Number.isFinite(targetMs)) return '--'

  const diffSeconds = Math.max(0, Math.floor((targetMs - nowMs) / 1000))
  const hours = Math.floor(diffSeconds / 3600)
  const minutes = Math.floor((diffSeconds % 3600) / 60)
  const seconds = diffSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function AlertPanel({
  alerts,
  settings,
  nextModelRun,
  scanStatus,
  onDismiss,
  onDismissAll,
  onToggleEnabled,
  onToggleDesktopNotifications,
  onMarkAllSeen,
}: AlertPanelProps) {
  const [notificationStatus, setNotificationStatus] = useState<'default' | 'granted' | 'denied'>('default')
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Check notification permission status
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationStatus(Notification.permission)
    }
  }, [settings.desktopNotifications])

  // Mark alerts as seen when panel is visible
  useEffect(() => {
    if (alerts.length > 0) {
      onMarkAllSeen()
    }
  }, [alerts.length, onMarkAllSeen])

  useEffect(() => {
    if (!nextModelRun) return
    const interval = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [nextModelRun])

  const handleNotificationToggle = async () => {
    if (!settings.desktopNotifications) {
      // Enabling - check if we need to request permission
      if ('Notification' in window) {
        if (Notification.permission === 'default') {
          const permission = await Notification.requestPermission()
          setNotificationStatus(permission)
          if (permission === 'granted') {
            onToggleDesktopNotifications()
          }
        } else if (Notification.permission === 'granted') {
          onToggleDesktopNotifications()
        }
      }
    } else {
      // Disabling
      onToggleDesktopNotifications()
    }
  }

  return (
    <div className="monitor-panel">
      <div className="tab-beta-disclaimer">
        Beta: still building. Verify independently before making decisions; it can make mistakes.
      </div>

      <div className="monitor-section">
        <div className="monitor-section-header">
          <div className="monitor-section-title">Settings</div>
        </div>
        <div className="monitor-settings">
          <label className="monitor-setting">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={onToggleEnabled}
            />
            <span>Enable alert detection</span>
          </label>
          <label className="monitor-setting">
            <input
              type="checkbox"
              checked={settings.desktopNotifications}
              onChange={handleNotificationToggle}
              disabled={!settings.enabled || notificationStatus === 'denied'}
            />
            <span>
              Desktop notifications
              {notificationStatus === 'denied' && (
                <span className="monitor-setting-note"> (blocked in browser)</span>
              )}
            </span>
          </label>
        </div>
      </div>

      <div className="monitor-section">
        <div className="monitor-section-header">
          <div className="monitor-section-title">
            Active Alerts
            {alerts.length > 0 && (
              <span className="monitor-alert-count">{alerts.length}</span>
            )}
          </div>
          <div className="monitor-scan-status">
            {scanStatus.scannedMarkets}/{scanStatus.totalMarkets} scanned
          </div>
          {alerts.length > 0 && (
            <button
              className="monitor-clear-btn"
              onClick={onDismissAll}
            >
              Clear all
            </button>
          )}
        </div>

        <div className="monitor-alerts">
          {!settings.enabled && (
            <div className="monitor-empty">
              Alert detection is disabled
            </div>
          )}

          {settings.enabled && alerts.length === 0 && (
            <div className="monitor-empty">
              No active alerts across monitored markets
            </div>
          )}

          {settings.enabled && alerts.length > 0 && (
            <div className="alert-list">
              {alerts.map(alert => (
                <AlertItem
                  key={alert.id}
                  alert={alert}
                  onDismiss={onDismiss}
                />
              ))}
            </div>
          )}

          {settings.enabled && (
            <div className="monitor-next-run-row">
              <div className="monitor-next-run-title">
                <span>Next Model Run</span>
                {scanStatus.lastScanAt && (
                  <span className="monitor-next-run-last-scan">
                    Last scan {new Date(scanStatus.lastScanAt).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {nextModelRun ? (
                <div className="monitor-next-run-body">
                  <div className="monitor-next-run-main">
                    {nextModelRun.model} • {nextModelRun.city} • {nextModelRun.targetDate}
                  </div>
                  <div className="monitor-next-run-meta">
                    in {formatCountdown(nextModelRun.nextRunAt, nowMs)} ({nextModelRun.nextRun} • {new Date(nextModelRun.nextRunAt).toLocaleTimeString()})
                  </div>
                </div>
              ) : (
                <div className="monitor-next-run-empty">No upcoming model run detected yet</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="monitor-section">
        <div className="monitor-section-header">
          <div className="monitor-section-title">Alert Types</div>
        </div>
        <div className="monitor-info">
          <div className="monitor-info-item">
            <span className="monitor-info-severity critical">Critical</span>
            <span>Observation passed bucket threshold but bucket still has high probability</span>
          </div>
          <div className="monitor-info-item">
            <span className="monitor-info-severity high">High</span>
            <span>All forecast models disagree with market favorite, or rapid market shift</span>
          </div>
          <div className="monitor-info-item">
            <span className="monitor-info-severity medium">Medium</span>
            <span>Consecutive observations with same bias direction, or new model run</span>
          </div>
          <div className="monitor-info-item">
            <span className="monitor-info-severity info">Info</span>
            <span>Model run upcoming</span>
          </div>
        </div>
      </div>
    </div>
  )
}
