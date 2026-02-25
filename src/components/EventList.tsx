import { useEffect, useMemo, useRef, useState } from 'react'
import type { MarketCategoryId, MarketEvent } from '@/types'
import type { LivePrice } from '@/hooks/useLivePrices'
import OutcomeTable from '@/components/OutcomeTable'
import TradeHistory from '@/components/TradeHistory'
import { useTrades } from '@/hooks/useTrades'
import { extractUniqueOutcomeNames } from '@/lib/outcome-names'

type WeatherDayFilter = 'all' | 'yesterday' | 'today' | 'tomorrow' | 'day-after'
type MarketSortFilter =
  | 'default'
  | 'most-active-1h'
  | 'most-active-24h'
  | 'biggest-move-24h'
  | 'closest-to-5050'
  | 'newest-listed'
  | 'near-resolution-high-liquidity'

interface EventListProps {
  events: MarketEvent[]
  selectedId: string | null
  expandedIds: string[]
  loading: boolean
  pinnedIds: string[]
  activeCategory: MarketCategoryId
  categoryLabel: string
  weatherDayFilter: WeatherDayFilter
  onWeatherDayFilterChange: (filter: WeatherDayFilter) => void
  marketSortFilter: MarketSortFilter
  onMarketSortFilterChange: (filter: MarketSortFilter) => void
  onSelect: (eventId: string) => void
  onToggle: (eventId: string) => void
  onTogglePin: (eventId: string) => void
  livePrices: Record<string, LivePrice>
  isMobile?: boolean
}

type ExpandedTab = 'orderbook' | 'trades'

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function formatResolutionCountdown(hoursToResolution: number | null) {
  if (hoursToResolution === null) return 'Resolution TBD'
  if (hoursToResolution > 24) return `${Math.ceil(hoursToResolution / 24)}d to resolve`
  return `${hoursToResolution}h to resolve`
}

function ExpandedSection({
  event,
  livePrices,
}: {
  event: MarketEvent
  livePrices: Record<string, LivePrice>
}) {
  const [tab, setTab] = useState<ExpandedTab>('orderbook')
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all')
  const primaryOutcome = event.outcomes[0]

  const outcomeNames = useMemo(
    () => extractUniqueOutcomeNames(event.outcomes),
    [event.outcomes]
  )

  // Get all conditionIds from outcomes
  const allConditionIds = useMemo(
    () => event.outcomes.map((o) => o.conditionId).filter((id): id is string => Boolean(id)),
    [event.outcomes]
  )

  // Fetch trades for all outcomes
  const { trades: allTrades, status } = useTrades(
    tab === 'trades' ? allConditionIds : []
  )

  // Filter trades client-side based on selected outcome's conditionId
  const filteredTrades = useMemo(() => {
    if (outcomeFilter === 'all') return allTrades
    const selectedOutcome = event.outcomes.find((o) => o.yesTokenId === outcomeFilter)
    if (!selectedOutcome?.conditionId) return allTrades
    return allTrades.filter((trade) => trade.conditionId === selectedOutcome.conditionId)
  }, [allTrades, outcomeFilter, event.outcomes])

  return (
    <div className="event-outcomes">
      <div className="expanded-tabs">
        <button
          className={`expanded-tab ${tab === 'orderbook' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setTab('orderbook') }}
        >
          Orderbook
        </button>
        <button
          className={`expanded-tab ${tab === 'trades' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setTab('trades') }}
        >
          Trades
        </button>
      </div>
      {tab === 'orderbook' && (
        <OutcomeTable outcomes={event.outcomes} livePrices={livePrices} />
      )}
      {tab === 'trades' && (
        <>
          <div className="trades-filter">
            <button
              className={`trades-filter-btn ${outcomeFilter === 'all' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setOutcomeFilter('all') }}
            >
              All
            </button>
            {event.outcomes.map((outcome) => (
              <button
                key={outcome.yesTokenId}
                className={`trades-filter-btn ${outcomeFilter === outcome.yesTokenId ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setOutcomeFilter(outcome.yesTokenId) }}
              >
                {outcomeNames.get(outcome.marketId) || outcome.question}
              </button>
            ))}
          </div>
          <TradeHistory trades={filteredTrades} status={status} />
        </>
      )}
    </div>
  )
}

export default function EventList({
  events,
  selectedId,
  expandedIds,
  loading,
  pinnedIds,
  activeCategory,
  categoryLabel,
  weatherDayFilter,
  onWeatherDayFilterChange,
  marketSortFilter,
  onMarketSortFilterChange,
  onSelect,
  onToggle,
  onTogglePin,
  livePrices,
  isMobile = false
}: EventListProps) {
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // On mobile, when an event is expanded, only show that event
  // This surfaces the Analysis/Historical tabs immediately below
  const mobileExpandedId = isMobile && expandedIds.length > 0 ? expandedIds[0] : null
  const displayEvents = mobileExpandedId
    ? events.filter(e => e.eventId === mobileExpandedId)
    : events

  useEffect(() => {
    if (!selectedId) return
    const card = cardRefs.current[selectedId]
    if (!card) return
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedId])

  return (
    <div className="events-list">
      {mobileExpandedId ? (
        <div className="mobile-focused-header">
          <button
            className="btn mobile-back-btn"
            onClick={() => onToggle(mobileExpandedId)}
          >
            ← Show all events
          </button>
        </div>
      ) : (
        <div className="events-filters">
          {activeCategory === 'weather' ? (
            <div className="day-filters">
              {[
                { id: 'all', label: 'All' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'today', label: 'Today' },
                { id: 'tomorrow', label: 'Tomorrow' },
                { id: 'day-after', label: 'Day after' }
              ].map((filter) => (
                <button
                  key={filter.id}
                  className="btn btn-filter"
                  onClick={() => onWeatherDayFilterChange(filter.id as WeatherDayFilter)}
                  style={{ borderColor: weatherDayFilter === filter.id ? 'var(--accent)' : undefined }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="day-filters">
              {[
                { id: 'default', label: 'Default' },
                { id: 'most-active-1h', label: 'Most active 1h' },
                { id: 'most-active-24h', label: 'Most active 24h' },
                { id: 'biggest-move-24h', label: 'Biggest move 24h' },
                { id: 'closest-to-5050', label: 'Closest 50/50' },
                { id: 'newest-listed', label: 'Newest listed' },
                { id: 'near-resolution-high-liquidity', label: 'Near resolve + liq' }
              ].map((filter) => (
                <button
                  key={filter.id}
                  className="btn btn-filter"
                  onClick={() => onMarketSortFilterChange(filter.id as MarketSortFilter)}
                  style={{ borderColor: marketSortFilter === filter.id ? 'var(--accent)' : undefined }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="events-scroll">
        {loading && <div className="empty-state">Loading markets…</div>}
        {!loading && !events.length && <div className="empty-state">No active {categoryLabel.toLowerCase()} markets found.</div>}
        {!loading && displayEvents.map((event) => {
          const isSelected = selectedId === event.eventId
          const isExpanded = expandedIds.includes(event.eventId)
          const isPinned = pinnedIds.includes(event.eventId)

          const handleToggle = () => {
            onSelect(event.eventId)
            onToggle(event.eventId)
          }

          return (
            <div
              key={event.eventId}
              ref={(el) => { cardRefs.current[event.eventId] = el }}
              className={`event-card ${isSelected ? 'selected' : ''}`}
            >
              <div className="event-header" onClick={handleToggle}>
                <div>
                  <div className="event-title">{event.title}</div>
                  <div className="event-meta">
                    <span className="event-meta-item">{event.categoryLabel}</span>
                    <span className="event-meta-item">{formatResolutionCountdown(event.hoursToResolution)}</span>
                    <span className="event-meta-item">Vol {formatNumber(event.volume)}</span>
                    <span className="event-meta-item">Liq {formatNumber(event.liquidity)}</span>
                    <span className="event-meta-item">Resolves {formatDateTime(event.resolveDate || event.endDate)}</span>
                  </div>
                </div>
                <div className="event-actions">
                  <button
                    className="analyze-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(event.eventId)
                      const analysisPanel = document.querySelector('.panel-right')
                      if (analysisPanel) {
                        analysisPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }
                    }}
                    aria-label="View analysis"
                    title="View analysis"
                  >
                    📊
                  </button>
                  <div className="event-toggle">{isExpanded ? '—' : '+'}</div>
                </div>
              </div>

              {isExpanded && (
                <ExpandedSection event={event} livePrices={livePrices} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
