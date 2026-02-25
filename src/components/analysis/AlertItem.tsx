import type { Alert } from '@/types/alerts'
import { SEVERITY_CONFIG } from '@/lib/alerts/config'

interface AlertItemProps {
  alert: Alert
  onDismiss: (id: string) => void
}

export function AlertItem({ alert, onDismiss }: AlertItemProps) {
  const severityConfig = SEVERITY_CONFIG[alert.severity]
  const timeAgo = getTimeAgo(alert.timestamp)
  const isResolved = alert.data?.isResolved === true

  // Format date for display (e.g., "Feb 13")
  const formattedDate = formatTargetDate(alert.targetDate)

  return (
    <div
      className={`alert-item ${isResolved ? 'alert-item-resolved' : ''}`}
      style={{ borderLeftColor: severityConfig.color }}
    >
      <div className="alert-item-content">
        <div className="alert-item-market-info">
          <span className="alert-item-city">{alert.city}</span>
          <span className="alert-item-date">{formattedDate}</span>
          {isResolved && <span className="alert-item-resolved-tag">RESOLVED</span>}
        </div>
        <div className="alert-item-header">
          <span
            className="alert-item-severity"
            style={{ color: severityConfig.color }}
          >
            {severityConfig.label}
          </span>
          <span className="alert-item-title">{alert.title}</span>
          <span className="alert-item-time">{timeAgo}</span>
        </div>
        <div className="alert-item-message">{alert.message}</div>
      </div>
      <button
        className="alert-item-dismiss"
        onClick={() => onDismiss(alert.id)}
        title="Dismiss"
      >
        ×
      </button>
    </div>
  )
}

function getTimeAgo(timestamp: string): string {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diffMs = now - then

  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return new Date(timestamp).toLocaleDateString()
}

function formatTargetDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr + 'T12:00:00')
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}
