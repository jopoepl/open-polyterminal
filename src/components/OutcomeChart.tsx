import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChart, ColorType, IChartApi, LineData, ISeriesApi, MouseEventParams, type Time, type UTCTimestamp } from 'lightweight-charts'
import type { MarketEvent, TimeRange } from '@/types'
import { usePriceHistory } from '@/hooks/usePriceHistory'
import { OUTCOME_SERIES_COLORS, formatOutcomeLegendLabel, sortOutcomesForDisplay } from '@/lib/outcome-visuals'

const RANGE_OPTIONS: TimeRange[] = ['1H', '1D', '1W', '1M', 'MAX']
const TIME_RANGE_SECONDS: Record<TimeRange, number | null> = {
  '1H': 60 * 60,
  '1D': 24 * 60 * 60,
  '1W': 7 * 24 * 60 * 60,
  '1M': 30 * 24 * 60 * 60,
  MAX: null
}

interface HoverEntry {
  tokenId: string
  value: number
  color: string
  label: string
}

interface HoverInfo {
  x: number
  entries: HoverEntry[]
}

interface OutcomeChartProps {
  event: MarketEvent | null
  range: TimeRange
  onRangeChange: (range: TimeRange) => void
  theme: 'dark' | 'light'
}

export default function OutcomeChart({ event, range, onRangeChange, theme }: OutcomeChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<Record<string, ISeriesApi<'Line'>>>({})
  const seriesTokenMap = useRef(new Map<ISeriesApi<'Line'>, string>())
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const [chartReady, setChartReady] = useState(false)
  const [seriesEpoch, setSeriesEpoch] = useState(0)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  const formatHistory = (history: Array<{ t: number; p: number }>) => {
    if (!history.length) return []
    const sorted = [...history].sort((a, b) => a.t - b.t)
    const deduped: LineData[] = []
    let lastTime: number | null = null
    sorted.forEach((point) => {
      if (point.t === lastTime) {
        deduped[deduped.length - 1] = { time: point.t as UTCTimestamp, value: point.p }
        return
      }
      deduped.push({ time: point.t as UTCTimestamp, value: point.p })
      lastTime = point.t
    })
    return deduped
  }

  const yesOutcomes = useMemo(() => {
    if (!event) return []
    return sortOutcomesForDisplay(event.outcomes)
      .map((outcome) => ({
        tokenId: outcome.yesTokenId,
        label: formatOutcomeLegendLabel(outcome)
      }))
  }, [event])

  const tokenIds = useMemo(() => yesOutcomes.map((o) => o.tokenId).filter(Boolean), [yesOutcomes])
  const fetchTokenIds = useMemo(() => Array.from(new Set(tokenIds)).sort(), [tokenIds])
  const { data, loading, error, refetch } = usePriceHistory(range, fetchTokenIds)
  const hasHistory = fetchTokenIds.some((tokenId) => (data[tokenId] || []).length > 0)
  const dataRef = useRef(data)
  const percentFormatter = useMemo(() => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }), [])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const applyTimeRangeToChart = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    const duration = TIME_RANGE_SECONDS[range] ?? null
    if (duration === null) {
      chart.timeScale().fitContent()
      return
    }

    const nowSeconds = Math.floor(Date.now() / 1000) as UTCTimestamp
    if (!Number.isFinite(nowSeconds)) return
    const fromSeconds = Math.max(0, nowSeconds - duration) as UTCTimestamp
    const timeScale = chart.timeScale()
    if (!timeScale) return

    if (!Number.isFinite(fromSeconds)) return
    if (fromSeconds > nowSeconds) return

    try {
      timeScale.setVisibleRange({
        from: fromSeconds,
        to: nowSeconds
      })
    } catch (error) {
      console.warn('chart time scale not ready for range', error)
    }
  }, [range])

  useEffect(() => {
    if (!containerRef.current) return

    const initialWidth = containerRef.current.clientWidth || 640
    const initialHeight = containerRef.current.clientHeight || 320

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme === 'dark' ? '#d4dbe3' : '#1b2430',
        fontFamily: 'JetBrains Mono, SF Mono, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace'
      },
      grid: {
        vertLines: { color: theme === 'dark' ? '#1f2a36' : '#d9dee6' },
        horzLines: { color: theme === 'dark' ? '#1f2a36' : '#d9dee6' }
      },
      rightPriceScale: {
        borderColor: theme === 'dark' ? '#1f2a36' : '#d9dee6'
      },
      timeScale: {
        borderColor: theme === 'dark' ? '#1f2a36' : '#d9dee6'
      },
      width: initialWidth,
      height: initialHeight
    })

    chartRef.current = chart
    setChartReady(true)

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = {}
      seriesTokenMap.current.clear()
      setChartReady(false)
    }
  }, [theme])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resize = () => {
      const chart = chartRef.current
      if (!chart) return
      const width = container.clientWidth || 640
      const height = container.clientHeight || 320
      if (sizeRef.current.width === width && sizeRef.current.height === height) return
      sizeRef.current = { width, height }
      chart.applyOptions({ width, height })
      applyTimeRangeToChart()
    }

    resize()

    const observer = new ResizeObserver(() => resize())
    observer.observe(container)

    return () => observer.disconnect()
  }, [chartReady])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !chartReady) return

    Object.values(seriesRef.current).forEach((series) => chart.removeSeries(series))
    seriesRef.current = {}
    seriesTokenMap.current.clear()
    sizeRef.current = { width: 0, height: 0 }

    yesOutcomes.forEach((outcome, index) => {
      const series = chart.addLineSeries({
        color: OUTCOME_SERIES_COLORS[index % OUTCOME_SERIES_COLORS.length],
        lineWidth: 2
      })
      seriesRef.current[outcome.tokenId] = series

      // If data is already here (e.g. cached / fast), apply immediately so we don't rely on effect timing.
      const history = dataRef.current[outcome.tokenId] || []
      series.setData(formatHistory(history))
      seriesTokenMap.current.set(series, outcome.tokenId)
    })

    applyTimeRangeToChart()
    // Signal that series exist so the data-application effect runs even if data arrived earlier.
    setSeriesEpoch((prev) => prev + 1)
  }, [yesOutcomes, chartReady])

  useEffect(() => {
    if (!chartRef.current || !chartReady) return

    // Small delay to ensure series are created
    const timer = setTimeout(() => {
      yesOutcomes.forEach((outcome) => {
        const series = seriesRef.current[outcome.tokenId]
        if (!series) return
        const history = data[outcome.tokenId] || []
        series.setData(formatHistory(history))
      })

      applyTimeRangeToChart()
    }, 50)

    return () => clearTimeout(timer)
  }, [data, yesOutcomes, chartReady, seriesEpoch])

  useEffect(() => {
    if (!chartReady) return
    applyTimeRangeToChart()
  }, [chartReady, applyTimeRangeToChart])

  // Update time scale formatter based on range
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !chartReady) return

    const showHours = range === '1H' || range === '1D'
    chart.applyOptions({
      localization: {
        timeFormatter: (time: UTCTimestamp) => {
          const date = new Date(time * 1000)
          if (showHours) {
            return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          }
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        }
      },
      timeScale: {
        tickMarkFormatter: (time: UTCTimestamp) => {
          const date = new Date(time * 1000)
          if (showHours) {
            return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          }
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        }
      }
    })
  }, [range, chartReady])

  useEffect(() => {
    if (!chartRef.current || !chartReady) return

    const handler = (param: MouseEventParams<Time>) => {
      const point = param.point
      if (!point) {
        setHoverInfo(null)
        return
      }

      const entries: HoverEntry[] = []

      for (const [series, dataPoint] of Array.from(param.seriesData.entries())) {
        const lineSeries = series as ISeriesApi<'Line'>
        const tokenId = seriesTokenMap.current.get(lineSeries)
        if (!tokenId) continue
        const value = dataPoint && 'value' in dataPoint ? dataPoint.value : undefined
        if (typeof value !== 'number' || !Number.isFinite(value)) continue

        const outcomeIndex = yesOutcomes.findIndex((o) => o.tokenId === tokenId)
        const outcome = yesOutcomes[outcomeIndex]
        if (!outcome) continue

        entries.push({
          tokenId,
          value,
          color: OUTCOME_SERIES_COLORS[outcomeIndex % OUTCOME_SERIES_COLORS.length],
          label: outcome.label
        })
      }

      if (entries.length === 0) {
        setHoverInfo(null)
        return
      }

      // Sort by value descending so highest probability is first
      entries.sort((a, b) => b.value - a.value)

      setHoverInfo({
        x: point.x,
        entries
      })
    }

    chartRef.current.subscribeCrosshairMove(handler)
    return () => {
      chartRef.current?.unsubscribeCrosshairMove(handler)
    }
  }, [chartReady, yesOutcomes])

  useEffect(() => {
    setHoverInfo(null)
    setHiddenSeries(new Set())
  }, [yesOutcomes])

  const formatPercentValue = (value: number) => `${percentFormatter.format(value * 100)}%`

  const toggleSeriesVisibility = (tokenId: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev)
      if (next.has(tokenId)) {
        next.delete(tokenId)
      } else {
        next.add(tokenId)
      }
      return next
    })
  }

  // Apply visibility changes to series
  useEffect(() => {
    if (!chartReady) return
    yesOutcomes.forEach((outcome) => {
      const series = seriesRef.current[outcome.tokenId]
      if (!series) return
      const isHidden = hiddenSeries.has(outcome.tokenId)
      series.applyOptions({
        visible: !isHidden
      })
    })
  }, [hiddenSeries, yesOutcomes, chartReady])

  return (
    <div className="fade-in">
      {event && (
        <div className="chart-toolbar">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              className="btn"
              onClick={() => onRangeChange(option)}
              style={{ borderColor: option === range ? 'var(--accent)' : undefined }}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <div className="chart-wrap" style={!event ? { visibility: 'hidden', height: 0, minHeight: 0 } : undefined}>
          <div ref={containerRef} className="chart-canvas" />
          {hoverInfo && hoverInfo.entries.length > 0 && (
            <div
              className="chart-hover-prices"
              style={{
                left: Math.min(Math.max(hoverInfo.x + 12, 0), Math.max(0, sizeRef.current.width - 160)),
                top: 8
              }}
            >
              {hoverInfo.entries.map((entry) => (
                <div key={entry.tokenId} className="chart-hover-entry" style={{ borderColor: entry.color }}>
                  <span className="chart-hover-label">{entry.label}</span>
                  <span className="chart-hover-value">{formatPercentValue(entry.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {!event && (
          <div className="empty-state">Select an event to view chart.</div>
        )}
        {event && loading && !hasHistory && (
          <div className="empty-state" style={{ marginTop: 8 }}>Loading price history...</div>
        )}
        {event && !loading && !hasHistory && (
          <div className="empty-state" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <span>{error ? 'Failed to load price history' : 'No history yet'}</span>
            <button className="btn" onClick={refetch} style={{ fontSize: 11 }}>
              Retry
            </button>
          </div>
        )}
        {event && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {yesOutcomes.map((outcome, index) => {
              const isHidden = hiddenSeries.has(outcome.tokenId)
              const color = OUTCOME_SERIES_COLORS[index % OUTCOME_SERIES_COLORS.length]
              return (
                <button
                  key={outcome.tokenId}
                  className="chart-legend-btn"
                  onClick={() => toggleSeriesVisibility(outcome.tokenId)}
                  style={{
                    borderColor: isHidden ? 'var(--border)' : color,
                    opacity: isHidden ? 0.4 : 1,
                    background: isHidden ? 'transparent' : undefined
                  }}
                  title={isHidden ? 'Click to show' : 'Click to hide'}
                >
                  <span
                    className="chart-legend-dot"
                    style={{ backgroundColor: isHidden ? 'var(--text-dim)' : color }}
                  />
                  {outcome.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
