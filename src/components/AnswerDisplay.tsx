import { useEffect, useMemo, useState } from 'react'
import type { AskFollowUpOption, AskSource } from '@/types'

interface AnswerDisplayProps {
  loading: boolean
  answer?: string | null
  error?: string | null
  sources: AskSource[]
  liveOutput?: string[]
  requiresClarification?: boolean
  followUpQuestion?: string | null
  followUpOptions?: AskFollowUpOption[]
  collapsed: boolean
  onToggle: () => void
  onClear: () => void
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatMarkdownBasic(markdown: string) {
  const escaped = escapeHtml(markdown)

  return escaped
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br />')
}

const SOURCE_PREVIEW_LIMIT = 4

export default function AnswerDisplay({
  loading,
  answer,
  error,
  sources,
  liveOutput = [],
  requiresClarification = false,
  followUpQuestion,
  followUpOptions = [],
  collapsed,
  onToggle,
  onClear
}: AnswerDisplayProps) {
  const [showAllSources, setShowAllSources] = useState(false)

  useEffect(() => {
    setShowAllSources(false)
  }, [sources])

  const visibleSources = useMemo(() => {
    if (showAllSources) return sources
    return sources.slice(0, SOURCE_PREVIEW_LIMIT)
  }, [showAllSources, sources])

  const hiddenSourceCount = Math.max(0, sources.length - SOURCE_PREVIEW_LIMIT)

  return (
    <section className="answer-panel">
      <div className="answer-header">
        <div className="panel-title">Analysis</div>
        <div className="answer-actions">
          <button className="btn" type="button" onClick={onToggle}>
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
          <button className="btn" type="button" onClick={onClear}>
            Clear
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="answer-body">
          {loading && <div className="empty-state">Running analysis…</div>}
          {liveOutput.length > 0 && (
            <div className="live-output">
              <div className="detail-label">Live output</div>
              <div className="live-output-log">
                {liveOutput.map((line, index) => (
                  <div key={`${index}-${line}`}>{line}</div>
                ))}
              </div>
            </div>
          )}
          {!loading && error && <div className="empty-state">{error}</div>}
          {!loading && !error && answer && (
            <div
              className="answer-markdown"
              dangerouslySetInnerHTML={{ __html: formatMarkdownBasic(answer) }}
            />
          )}
          {!loading && !error && requiresClarification && (
            <div className="clarification-card">
              <div className="detail-label">Need clarification</div>
              <div>{followUpQuestion || 'Multiple markets match this question. Please clarify.'}</div>
              <div className="clarification-options">
                {followUpOptions.map((option, index) => (
                  <div key={option.id} className="clarification-option">
                    <strong>{index + 1}.</strong> {option.label}
                    {option.detail && <span className="clarification-detail">{option.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && !error && !requiresClarification && sources.length > 0 && (
            <div className="sources-list">
              <div className="detail-label">Sources</div>
              {visibleSources.map((source) => (
                <div key={source.id} className="source-item">
                  {source.url ? (
                    <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
                  ) : (
                    <span>{source.label}</span>
                  )}
                </div>
              ))}
              {hiddenSourceCount > 0 && !showAllSources && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => setShowAllSources(true)}
                  style={{ marginTop: 8 }}
                >
                  Show {hiddenSourceCount} more
                </button>
              )}
              {sources.length > SOURCE_PREVIEW_LIMIT && showAllSources && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => setShowAllSources(false)}
                  style={{ marginTop: 8 }}
                >
                  Show fewer
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
