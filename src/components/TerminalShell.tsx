import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import { useIsMobile } from '@/hooks/useIsMobile'

type RightPanelTab = 'details' | 'data' | 'historical' | 'monitor'
import EventList from '@/components/EventList'
import OutcomeChart from '@/components/OutcomeChart'
import DataPanel from '@/components/DataPanel'
import HistoricalPanel from '@/components/analysis/HistoricalPanel'
import { useTheme } from '@/hooks/useTheme'
import { useLivePrices, type LivePrice } from '@/hooks/useLivePrices'
import { useOrderbook } from '@/hooks/useOrderbook'
import { useWallet } from '@/hooks/useWallet'
import { useWeatherAnalysis } from '@/hooks/useWeatherAnalysis'
import { useAlertEngine, type AlertMonitorTarget } from '@/hooks/useAlertEngine'
import { AlertPanel } from '@/components/analysis/AlertPanel'
import { extractCityFromText } from '@/lib/weather/stations'
import type { MarketCategoryId, MarketEvent, MarketHubResponse, TimeRange } from '@/types'

const CATEGORY_LABELS: Record<MarketCategoryId, string> = {
  all: 'All',
  weather: 'Weather',
  sports: 'Sports',
  politics: 'Politics',
  crypto: 'Crypto',
  business: 'Business',
  culture: 'Culture'
}

type WeatherDayFilter = 'all' | 'yesterday' | 'today' | 'tomorrow' | 'day-after'
type MarketSortFilter =
  | 'default'
  | 'most-active-1h'
  | 'most-active-24h'
  | 'biggest-move-24h'
  | 'closest-to-5050'
  | 'newest-listed'
  | 'near-resolution-high-liquidity'

function parseTargetDateFromTitle(title: string): string | null {
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ]
  const lower = title.toLowerCase()

  for (let i = 0; i < months.length; i++) {
    const pattern = new RegExp(`${months[i]}\\s+(\\d{1,2})`, 'i')
    const match = lower.match(pattern)
    if (match) {
      const day = parseInt(match[1], 10)
      const month = i + 1
      const now = new Date()
      let year = now.getFullYear()
      const candidate = new Date(year, month - 1, day)
      if (candidate.getTime() < now.getTime() - 7 * 24 * 60 * 60 * 1000) {
        year += 1
      }
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  return null
}

function getUnitFromOutcomes(outcomes: MarketEvent['outcomes']): 'C' | 'F' {
  for (const outcome of outcomes) {
    if (outcome.target?.unit) return outcome.target.unit
  }
  return 'F'
}

function getMarketBucket(outcomes: MarketEvent['outcomes']): { low: number; high: number } | null {
  let bestOutcome: typeof outcomes[0] | null = null
  let bestPrice = 0

  for (const outcome of outcomes) {
    if (outcome.yesPrice !== null && outcome.yesPrice > bestPrice) {
      bestPrice = outcome.yesPrice
      bestOutcome = outcome
    }
  }

  if (bestOutcome?.target?.type === 'range' && bestOutcome?.target?.value !== undefined && bestOutcome?.target?.value2 !== undefined) {
    return { low: bestOutcome.target.value, high: bestOutcome.target.value2 }
  }

  return null
}

export default function TerminalShell() {
  const { theme, setTheme } = useTheme()
  const isMobile = useIsMobile()
  const wallet = useWallet()
  const [events, setEvents] = useState<MarketEvent[]>([])
  const [monitorWeatherEvents, setMonitorWeatherEvents] = useState<MarketEvent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('details')
  const [activeCategory, setActiveCategory] = useState<MarketCategoryId>('weather')
  const [range, setRange] = useState<TimeRange>('1W')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [liveEnabled, setLiveEnabled] = useState(false)
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [weatherDayFilter, setWeatherDayFilter] = useState<WeatherDayFilter>('today')
  const [marketSortFilter, setMarketSortFilter] = useState<MarketSortFilter>('default')
  const [centerWidth, setCenterWidth] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const layoutRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let isMounted = true

    const fetchData = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/market-hub?category=weather')
        if (!res.ok) throw new Error('Failed to fetch')
        const json: MarketHubResponse = await res.json()
        if (!isMounted) return
        setEvents(json.events)
        setLastUpdated(json.fetchedAt)
        if (!selectedId && json.events.length) {
          setSelectedId(json.events[0].eventId)
        }
        setExpandedIds([])
      } catch (err) {
        if (!isMounted) return
        setError(`Failed to load ${CATEGORY_LABELS[activeCategory].toLowerCase()} markets`)
      } finally {
        if (!isMounted) return
        setLoading(false)
      }
    }

    fetchData()

    return () => {
      isMounted = false
    }
  }, [activeCategory])

  useEffect(() => {
    let isMounted = true

    const fetchWeatherMarketsForMonitor = async () => {
      try {
        const res = await fetch('/api/market-hub?category=weather')
        if (!res.ok) return
        const json: MarketHubResponse = await res.json()
        if (!isMounted) return
        setMonitorWeatherEvents(json.events)
      } catch {
        // Keep existing monitor markets on transient failures
      }
    }

    fetchWeatherMarketsForMonitor()
    const interval = setInterval(fetchWeatherMarketsForMonitor, 60000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [])


  useEffect(() => {
    if (!isResizing) return

    const handleMove = (event: MouseEvent) => {
      if (!layoutRef.current) return
      const rect = layoutRef.current.getBoundingClientRect()
      const sidebarWidth = 140
      const gap = 16
      const minWidth = 280
      const maxWidth = rect.width - sidebarWidth - gap - 320
      const nextWidth = event.clientX - rect.left - sidebarWidth - gap
      const clamped = Math.min(Math.max(nextWidth, minWidth), maxWidth)
      setCenterWidth(clamped)
    }

    const handleUp = () => setIsResizing(false)

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'col-resize'

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
    }
  }, [isResizing])

  const selectedEvent = useMemo(() => {
    if (!events.length) return null
    return events.find((event) => event.eventId === selectedId) || events[0]
  }, [events, selectedId])

  // Preload weather analysis data when event is selected (regardless of active tab)
  const weatherAnalysisParsed = useMemo(() => {
    if (!selectedEvent || selectedEvent.category !== 'weather') return null

    const city = extractCityFromText(selectedEvent.title)
    const targetDate = parseTargetDateFromTitle(selectedEvent.title)
    const unit = getUnitFromOutcomes(selectedEvent.outcomes)
    const marketBucket = getMarketBucket(selectedEvent.outcomes)

    if (!city || !targetDate) return null

    return { city, targetDate, unit, marketBucket }
  }, [selectedEvent])

  const weatherAnalysis = useWeatherAnalysis({
    city: weatherAnalysisParsed?.city ?? null,
    date: weatherAnalysisParsed?.targetDate ?? null,
    unit: weatherAnalysisParsed?.unit ?? 'F',
    refreshInterval: 60000
  })

  const alertMonitorTargets = useMemo<AlertMonitorTarget[]>(() => {
    const sourceEvents = monitorWeatherEvents.length > 0
      ? monitorWeatherEvents
      : events.filter(event => event.category === 'weather')

    return sourceEvents
      .filter(event => event.category === 'weather')
      .map(event => {
        const city = extractCityFromText(event.title)
        const targetDate = parseTargetDateFromTitle(event.title)
        const unit = getUnitFromOutcomes(event.outcomes)

        if (!city || !targetDate) return null

        return {
          event,
          city,
          targetDate,
          unit,
        }
      })
      .filter((target): target is AlertMonitorTarget => target !== null)
  }, [monitorWeatherEvents, events])

  const alertEngine = useAlertEngine({
    monitorTargets: alertMonitorTargets,
  })

  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const now = new Date()
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const toAnchorDate = (event: MarketEvent) => {
      const value = event.resolveDate || event.endDate || event.startDate
      if (!value) return null
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) return null
      return parsed
    }

    const dayDiffFromToday = (event: MarketEvent) => {
      const anchor = toAnchorDate(event)
      if (!anchor) return null
      const eventDay = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
      const diffMs = eventDay.getTime() - todayMidnight.getTime()
      return Math.round(diffMs / (1000 * 60 * 60 * 24))
    }

    const matchesSearch = (event: MarketEvent) => {
      if (!query) return true
      const haystack = `${event.title} ${event.slug} ${event.tags.join(' ')}`.toLowerCase()
      return haystack.includes(query)
    }

    const matchesWeatherDayFilter = (event: MarketEvent) => {
      if (activeCategory !== 'weather') return true
      if (weatherDayFilter === 'all') return true

      const diff = dayDiffFromToday(event)
      if (diff === null) return false
      if (weatherDayFilter === 'yesterday') return diff === -1
      if (weatherDayFilter === 'today') return diff === 0
      if (weatherDayFilter === 'tomorrow') return diff === 1
      return diff === 2
    }

    const filtered = events.filter((event) => matchesSearch(event) && matchesWeatherDayFilter(event))
    const sorted = [...filtered].sort((a, b) => {
      if (activeCategory !== 'weather') {
        if (marketSortFilter === 'most-active-1h') {
          if (b.activity1hEstimate !== a.activity1hEstimate) return b.activity1hEstimate - a.activity1hEstimate
        } else if (marketSortFilter === 'most-active-24h') {
          if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h
        } else if (marketSortFilter === 'biggest-move-24h') {
          if (b.maxAbsMove24h !== a.maxAbsMove24h) return b.maxAbsMove24h - a.maxAbsMove24h
        } else if (marketSortFilter === 'closest-to-5050') {
          const da = a.closestToMid === null ? Number.MAX_SAFE_INTEGER : a.closestToMid
          const db = b.closestToMid === null ? Number.MAX_SAFE_INTEGER : b.closestToMid
          if (da !== db) return da - db
        } else if (marketSortFilter === 'newest-listed') {
          const ta = Date.parse(a.createdAt || a.startDate || '')
          const tb = Date.parse(b.createdAt || b.startDate || '')
          if (Number.isFinite(ta) || Number.isFinite(tb)) return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
        } else if (marketSortFilter === 'near-resolution-high-liquidity') {
          const ah = a.hoursToResolution === null ? Number.MAX_SAFE_INTEGER : Math.max(0, a.hoursToResolution)
          const bh = b.hoursToResolution === null ? Number.MAX_SAFE_INTEGER : Math.max(0, b.hoursToResolution)
          const scoreA = ah === Number.MAX_SAFE_INTEGER ? 0 : a.liquidity / (ah + 1)
          const scoreB = bh === Number.MAX_SAFE_INTEGER ? 0 : b.liquidity / (bh + 1)
          if (scoreB !== scoreA) return scoreB - scoreA
        }
      }

      const ah = a.hoursToResolution === null ? Number.MAX_SAFE_INTEGER : a.hoursToResolution
      const bh = b.hoursToResolution === null ? Number.MAX_SAFE_INTEGER : b.hoursToResolution
      if (ah !== bh) return ah - bh
      return (a.resolveDate || a.endDate || '').localeCompare(b.resolveDate || b.endDate || '')
    })

    const pinnedSet = new Set(pinnedIds)
    const pinned = sorted.filter((event) => pinnedSet.has(event.eventId))
    const unpinned = sorted.filter((event) => !pinnedSet.has(event.eventId))
    return [...pinned, ...unpinned]
  }, [events, searchQuery, pinnedIds, activeCategory, weatherDayFilter, marketSortFilter])

  useEffect(() => {
    if (!filteredEvents.length) return
    if (selectedId && filteredEvents.some((event) => event.eventId === selectedId)) return
    setSelectedId(filteredEvents[0].eventId)
  }, [filteredEvents, selectedId])

  const orderbookTokenIds = useMemo(() => {
    const ids = new Set<string>()
    const relevantIds = selectedEvent ? [selectedEvent.eventId] : []
    const allIds = [...relevantIds, ...expandedIds]
    for (const eid of allIds) {
      const ev = events.find((e) => e.eventId === eid)
      if (!ev) continue
      for (const o of ev.outcomes) {
        if (o.yesTokenId) ids.add(o.yesTokenId)
        if (o.noTokenId) ids.add(o.noTokenId)
      }
    }
    return Array.from(ids)
  }, [events, selectedEvent, expandedIds])

  const { data: orderbookData } = useOrderbook(orderbookTokenIds)

  const liveTokenIds = useMemo(() => {
    if (!selectedEvent || !liveEnabled) return []
    return selectedEvent.outcomes.flatMap((o) => [o.yesTokenId, o.noTokenId]).filter(Boolean)
  }, [selectedEvent, liveEnabled])

  const livePrices = useLivePrices(liveTokenIds, liveEnabled)

  const mergedPrices = useMemo(() => {
    const merged: Record<string, LivePrice> = {}
    for (const [tokenId, book] of Object.entries(orderbookData)) {
      merged[tokenId] = { ...book, bids: [], asks: [] }
    }
    for (const [tokenId, live] of Object.entries(livePrices)) {
      merged[tokenId] = { ...live }
    }
    return merged
  }, [orderbookData, livePrices])

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')
  const toggleExpanded = (eventId: string) => {
    setExpandedIds((prev) => (
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]
    ))
  }
  const togglePinned = (eventId: string) => {
    setPinnedIds((prev) => (
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [eventId, ...prev]
    ))
  }

  const formatDate = (value: string | null | undefined) => {
    if (!value) return '—'
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return parsed.toLocaleString()
  }

  const formatNumber = (value: number) => {
    if (!Number.isFinite(value)) return '—'
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
  }

  const formatPercent = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—'
    return `${(value * 100).toFixed(1)}%`
  }

  const rankingLabel = useMemo(() => {
    if (activeCategory === 'weather') return 'soonest resolution'
    if (marketSortFilter === 'most-active-1h') return 'most active (1h est)'
    if (marketSortFilter === 'most-active-24h') return 'most active (24h)'
    if (marketSortFilter === 'biggest-move-24h') return 'biggest move (24h)'
    if (marketSortFilter === 'closest-to-5050') return 'closest to 50/50'
    if (marketSortFilter === 'newest-listed') return 'newest listed'
    if (marketSortFilter === 'near-resolution-high-liquidity') return 'near resolution + high liquidity'
    return 'default ranking'
  }, [activeCategory, marketSortFilter])

  const spotlightEvents = useMemo(() => {
    return [...filteredEvents]
      .sort((a, b) => {
        if (activeCategory === 'weather') {
          const ah = a.hoursToResolution === null ? Number.MAX_SAFE_INTEGER : a.hoursToResolution
          const bh = b.hoursToResolution === null ? Number.MAX_SAFE_INTEGER : b.hoursToResolution
          return ah - bh
        }

        if (marketSortFilter === 'most-active-1h') return b.activity1hEstimate - a.activity1hEstimate
        if (marketSortFilter === 'most-active-24h') return b.volume24h - a.volume24h
        if (marketSortFilter === 'biggest-move-24h') return b.maxAbsMove24h - a.maxAbsMove24h
        if (marketSortFilter === 'closest-to-5050') {
          const da = a.closestToMid === null ? Number.MAX_SAFE_INTEGER : a.closestToMid
          const db = b.closestToMid === null ? Number.MAX_SAFE_INTEGER : b.closestToMid
          return da - db
        }
        if (marketSortFilter === 'newest-listed') {
          const ta = Date.parse(a.createdAt || a.startDate || '')
          const tb = Date.parse(b.createdAt || b.startDate || '')
          return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
        }
        if (marketSortFilter === 'near-resolution-high-liquidity') {
          const ah = a.hoursToResolution === null ? Number.MAX_SAFE_INTEGER : Math.max(0, a.hoursToResolution)
          const bh = b.hoursToResolution === null ? Number.MAX_SAFE_INTEGER : Math.max(0, b.hoursToResolution)
          const scoreA = ah === Number.MAX_SAFE_INTEGER ? 0 : a.liquidity / (ah + 1)
          const scoreB = bh === Number.MAX_SAFE_INTEGER ? 0 : b.liquidity / (bh + 1)
          return scoreB - scoreA
        }
        return b.volume - a.volume
      })
      .slice(0, 8)
  }, [filteredEvents, activeCategory, marketSortFilter])

  const relatedEvents = useMemo(() => {
    if (!selectedEvent) return []

    const eventCategory = selectedEvent.category

    return events
      .filter((event) => event.eventId !== selectedEvent.eventId && event.category === eventCategory)
      .sort((a, b) => {
        const ah = a.hoursToResolution ?? Number.MAX_SAFE_INTEGER
        const bh = b.hoursToResolution ?? Number.MAX_SAFE_INTEGER
        return ah - bh
      })
      .slice(0, 8)
  }, [selectedEvent, events])

  const gridStyle = centerWidth
    ? { gridTemplateColumns: `140px ${centerWidth}px minmax(400px, 1fr)` }
    : undefined

  return (
    <div className="container">
      <header className="topbar">
        <div className="topbar-main">
          <div>
            <Link href="/" className="topbar-title topbar-title-link">
              PolyTerminal
            </Link>
            <div className="topbar-subtitle">Understand prediction markets with data</div>
          </div>
          <div className="topbar-actions">
            <div className="category-dropdown">
              <button
                className="btn category-dropdown-toggle"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {CATEGORY_LABELS[activeCategory]} {mobileMenuOpen ? '▲' : '▼'}
              </button>
              {mobileMenuOpen && (
                <div className="category-dropdown-menu">
                  {(Object.keys(CATEGORY_LABELS) as MarketCategoryId[]).map((cat) => (
                    <button
                      key={cat}
                      className={`category-dropdown-item ${activeCategory === cat ? 'active' : ''}`}
                      onClick={() => {
                        setActiveCategory(cat)
                        setMobileMenuOpen(false)
                      }}
                    >
                      {CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <a
              className="btn"
              href="https://tally.so/r/obMdp5"
              target="_blank"
              rel="noopener noreferrer"
            >
              Feedback
            </a>
            <button className="btn" onClick={toggleTheme}>
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>
      </header>

      <div className="terminal-layout" ref={layoutRef} style={gridStyle}>
        <Sidebar
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
        />

        <div className="panel panel-center">
          <div className="panel-header">
            <div className="panel-title">Events</div>
            <div className="panel-title">{loading ? 'Loading…' : `${filteredEvents.length} active`}</div>
          </div>
          <div className="panel-content panel-controls">
                <input
                  className="search-input"
                  placeholder="Search title, slug, or tag…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
          </div>
          <div className="panel-content panel-events">
            {error && <div className="empty-state">{error}</div>}
            {!error && (
              <EventList
                events={filteredEvents}
                selectedId={selectedEvent?.eventId || null}
                expandedIds={expandedIds}
                loading={loading}
                onSelect={setSelectedId}
                onToggle={toggleExpanded}
                pinnedIds={pinnedIds}
                onTogglePin={togglePinned}
                activeCategory={activeCategory}
                categoryLabel={CATEGORY_LABELS[activeCategory]}
                weatherDayFilter={weatherDayFilter}
                onWeatherDayFilterChange={setWeatherDayFilter}
                marketSortFilter={marketSortFilter}
                onMarketSortFilterChange={setMarketSortFilter}
                livePrices={mergedPrices}
                isMobile={isMobile}
              />
            )}
          </div>
          <div className="resize-handle" onMouseDown={() => setIsResizing(true)} />
        </div>

        <div className="panel panel-right">
          <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0, padding: 0 }}>
            <div className="right-panel-tabs">
              <button
                className={`right-panel-tab ${rightPanelTab === 'details' ? 'active' : ''}`}
                onClick={() => {
                  const scrollY = window.scrollY
                  setRightPanelTab('details')
                  requestAnimationFrame(() => window.scrollTo(0, scrollY))
                }}
              >
                Market Details
              </button>
              <button
                className={`right-panel-tab ${rightPanelTab === 'data' ? 'active' : ''}`}
                onClick={() => {
                  const scrollY = window.scrollY
                  setRightPanelTab('data')
                  requestAnimationFrame(() => window.scrollTo(0, scrollY))
                }}
              >
                Analysis
              </button>
              <button
                className={`right-panel-tab ${rightPanelTab === 'historical' ? 'active' : ''}`}
                onClick={() => {
                  const scrollY = window.scrollY
                  setRightPanelTab('historical')
                  requestAnimationFrame(() => window.scrollTo(0, scrollY))
                }}
              >
                Historical
                <span className="tab-beta">Beta</span>
              </button>
              <button
                className={`right-panel-tab ${rightPanelTab === 'monitor' ? 'active' : ''}`}
                onClick={() => {
                  const scrollY = window.scrollY
                  setRightPanelTab('monitor')
                  requestAnimationFrame(() => window.scrollTo(0, scrollY))
                }}
              >
                Monitor
                <span className="tab-beta">Beta</span>
                {alertEngine.unreadCount > 0 && (
                  <span className="tab-badge">{alertEngine.unreadCount}</span>
                )}
              </button>
            </div>
          </div>
          <div className="panel-content">
            {rightPanelTab === 'data' && (
              <DataPanel
                selectedEvent={selectedEvent}
                category={activeCategory}
                theme={theme}
                preloadedAnalysis={weatherAnalysis}
                preloadedParsed={weatherAnalysisParsed}
              />
            )}
            {rightPanelTab === 'historical' && (
              <HistoricalPanel selectedEvent={selectedEvent} theme={theme} />
            )}
            {rightPanelTab === 'monitor' && (
              <div className="monitor-tab-content">
                <AlertPanel
                  alerts={alertEngine.alerts}
                  settings={alertEngine.settings}
                  nextModelRun={alertEngine.nextModelRun}
                  scanStatus={alertEngine.scanStatus}
                  onDismiss={alertEngine.dismissAlert}
                  onDismissAll={alertEngine.clearAllAlerts}
                  onToggleEnabled={alertEngine.toggleEnabled}
                  onToggleDesktopNotifications={alertEngine.toggleDesktopNotifications}
                  onMarkAllSeen={alertEngine.markAllSeen}
                />
              </div>
            )}
            {rightPanelTab === 'details' && (
              <>
                <OutcomeChart event={selectedEvent} range={range} onRangeChange={setRange} theme={theme} />

                {selectedEvent && (
                  <div className="detail-grid">
                    <div className="detail-item">
                      <div className="detail-label">Category</div>
                      <div>{selectedEvent.categoryLabel}</div>
                    </div>
                    <div className="detail-item">
                      <div className="detail-label">Volume</div>
                      <div>{formatNumber(selectedEvent.volume)}</div>
                    </div>
                    <div className="detail-item">
                      <div className="detail-label">Liquidity</div>
                      <div>{formatNumber(selectedEvent.liquidity)}</div>
                    </div>
                    <div className="detail-item">
                      <div className="detail-label">Resolves</div>
                      <div>{formatDate(selectedEvent.resolveDate || selectedEvent.endDate)}</div>
                    </div>
                  </div>
                )}

                {relatedEvents.length > 0 && (
                  <div className="highest-temp-section">
                    <div className="panel-title">Related Markets</div>
                    <div className="highest-temp-list">
                      {relatedEvents.map((event) => (
                        <button
                          key={event.eventId}
                          className="highest-temp-item highest-temp-item-clickable"
                          onClick={() => setSelectedId(event.eventId)}
                        >
                          <div>
                            <div className="highest-temp-rank">{event.title}</div>
                            <div className="highest-temp-meta">{formatDate(event.resolveDate || event.endDate)}</div>
                          </div>
                          <div className="highest-temp-value">
                            {event.hoursToResolution === null ? '—' : `${event.hoursToResolution}h`}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {lastUpdated && (
                  <div className="empty-state" style={{ marginTop: 12 }}>
                    Last updated {new Date(lastUpdated).toLocaleString()}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <footer className="app-footer">
        Third-party data. Verify independently. Not financial advice.
      </footer>
    </div>
  )
}
