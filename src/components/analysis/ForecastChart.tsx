import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChart, ColorType, IChartApi, ISeriesApi, MouseEventParams, type Time, type UTCTimestamp } from 'lightweight-charts'
import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'
import InfoTooltip from './InfoTooltip'

const MODEL_COLORS: Record<string, string> = {
  'GFS': '#39d38a',
  'ECMWF': '#f472b6',
  'ICON': '#38bdf8',
  'ARPEGE': '#fb923c',
  'UKMO': '#22d3d3',
  'GEM': '#a3e635',
  'JMA': '#e879f9',
}

const OBSERVED_COLOR = '#ff6b6b' // Red for observed temperature
const MODEL_AVG_COLOR = '#ffd700' // Gold/yellow for model average

interface HoverEntry {
  model: string
  value: number
  color: string
}

interface HoverInfo {
  x: number
  time: string
  entries: HoverEntry[]
}

interface ForecastChartProps {
  data: WeatherAnalysisResponse
  theme: 'dark' | 'light'
  marketBucket?: { low: number; high: number } | null
}

function formatDuration(minutes: number): string {
  const hrs = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`
  if (hrs > 0) return `${hrs}h`
  return `${mins}m`
}

function formatCountdownFromMs(targetMs: number | null, nowMs: number): string {
  if (targetMs === null || !Number.isFinite(targetMs)) return '--'
  if (targetMs <= nowMs) return '--'
  const diffSeconds = Math.floor((targetMs - nowMs) / 1000)

  const hours = Math.floor(diffSeconds / 3600)
  const minutes = Math.floor((diffSeconds % 3600) / 60)
  const seconds = diffSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

// Calculate how long ago the last run was based on lastRun time (e.g., "06Z")
function getDataAge(lastRun: string): number {
  const runHour = parseInt(lastRun.replace('Z', ''))
  const now = new Date()
  const currentHour = now.getUTCHours()
  const currentMinute = now.getUTCMinutes()

  let hoursAgo = currentHour - runHour
  if (hoursAgo < 0) hoursAgo += 24 // Handle day wrap

  return hoursAgo * 60 + currentMinute
}

export default function ForecastChart({ data, theme, marketBucket }: ForecastChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const seriesModelMap = useRef<Map<ISeriesApi<'Line'>, string>>(new Map())
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const [visibleModels, setVisibleModels] = useState<Set<string>>(new Set([...Object.keys(MODEL_COLORS), 'Observed', 'Predicted Peak']))
  const [chartReady, setChartReady] = useState(false)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const { models, target, modelUpdates, observations, station } = data
  const timezone = station.timezone || 'UTC'
  const modelUpdateAnchorRef = useRef<number>(Date.now())

  useEffect(() => {
    modelUpdateAnchorRef.current = Date.now()
  }, [modelUpdates])

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Get timezone offset in hours for the station's timezone
  const getTimezoneOffsetHours = useCallback((dateStr: string): number => {
    const [year, month, day] = dateStr.split('-').map(Number)
    const noonUTC = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
    const localHour = parseInt(noonUTC.toLocaleString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false
    }))
    return localHour - 12
  }, [timezone])

  // Helper to get UTC timestamp for midnight in the station's local timezone
  const getStationMidnightUTC = useCallback((dateStr: string): number => {
    const [year, month, day] = dateStr.split('-').map(Number)
    const offsetHours = getTimezoneOffsetHours(dateStr)
    const midnightUTC = Date.UTC(year, month - 1, day, 0, 0, 0)
    return midnightUTC - (offsetHours * 60 * 60 * 1000)
  }, [getTimezoneOffsetHours])

  // Parse a time string that's in station's local timezone and return UTC timestamp
  // e.g., "2026-02-12T10:00" in London timezone -> correct UTC timestamp
  const parseStationLocalTime = useCallback((timeStr: string): number => {
    // Extract date and time components
    const [datePart, timePart] = timeStr.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute] = (timePart || '00:00').split(':').map(Number)

    // Get the timezone offset for this date
    const offsetHours = getTimezoneOffsetHours(datePart)

    // Create UTC timestamp for this local time
    // If it's 10:00 local and offset is +5, then UTC is 10:00 - 5 = 05:00
    const localAsUTC = Date.UTC(year, month - 1, day, hour, minute || 0, 0)
    return localAsUTC - (offsetHours * 60 * 60 * 1000)
  }, [getTimezoneOffsetHours])

  // Helper to format time in station's local timezone
  const formatLocalTime = useCallback((timestamp: number) => {
    const date = new Date(timestamp * 1000)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone
    })
  }, [timezone])

  // Parse hourly temps and create line data for models
  // Open-Meteo returns times in station's local timezone (no Z suffix) when using timezone=auto
  const modelData = useMemo(() => {
    const result: Record<string, Array<{ time: UTCTimestamp; value: number }>> = {}

    for (const model of models) {
      if (model.hourlyTemps.length === 0) continue

      const lineData = model.hourlyTemps
        .map(pt => {
          // Model times from Open-Meteo are in station's local timezone (no Z)
          // Use our helper to parse correctly regardless of user's browser timezone
          const time = parseStationLocalTime(pt.time) / 1000
          return {
            time: Math.floor(time) as UTCTimestamp,
            value: pt.temp
          }
        })
        .sort((a, b) => a.time - b.time)

      if (lineData.length > 0) {
        result[model.name] = lineData
      }
    }

    return result
  }, [models, parseStationLocalTime])

  // Parse observations into chart data
  // Observations from aviationweather.gov are in UTC (with Z suffix)
  const observationData = useMemo(() => {
    if (!observations || observations.length === 0) return []

    return observations
      .filter(obs => obs.temp !== null)
      .map(obs => {
        // Handle both ISO format (with Z) and Iowa format (no Z)
        const timeStr = obs.time.includes('Z') || obs.time.includes('+')
          ? obs.time
          : obs.time.replace(' ', 'T') + 'Z'
        return {
          time: Math.floor(new Date(timeStr).getTime() / 1000) as UTCTimestamp,
          value: obs.temp as number
        }
      })
      .sort((a, b) => a.time - b.time)
  }, [observations])

  const hasObservations = observationData.length > 0

  // Create chart
  useEffect(() => {
    if (!containerRef.current) return

    // Custom time formatter for station's local timezone
    const timeFormatter = (time: UTCTimestamp) => {
      const date = new Date(time * 1000)
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: timezone
      })
    }

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
        borderColor: theme === 'dark' ? '#1f2a36' : '#d9dee6',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: timeFormatter
      },
      localization: {
        timeFormatter: timeFormatter
      },
      crosshair: {
        mode: 1, // Magnet mode
        vertLine: {
          labelVisible: true
        },
        horzLine: {
          labelVisible: true
        }
      },
      width: containerRef.current.clientWidth || 500,
      height: 280
    })

    chartRef.current = chart
    sizeRef.current = { width: containerRef.current.clientWidth || 500, height: 280 }
    setChartReady(true)

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current.clear()
      seriesModelMap.current.clear()
      setChartReady(false)
    }
  }, [theme, timezone])

  // Handle resize
  useEffect(() => {
    const container = containerRef.current
    const chart = chartRef.current
    if (!container || !chart) return

    const observer = new ResizeObserver(() => {
      const width = container.clientWidth || 500
      sizeRef.current = { width, height: 280 }
      chart.applyOptions({ width })
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [chartReady])

  // Update series when data or visibility changes
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !chartReady) return

    // Remove old series
    seriesRef.current.forEach(series => {
      chart.removeSeries(series)
    })
    seriesRef.current.clear()
    seriesModelMap.current.clear()

    // Add new series for visible models
    let hasData = false
    Object.entries(modelData).forEach(([modelName, lineData]) => {
      if (!visibleModels.has(modelName)) return
      if (lineData.length === 0) return

      const color = MODEL_COLORS[modelName] || '#888888'
      const series = chart.addLineSeries({
        color,
        lineWidth: 2,
        title: '',
        lastValueVisible: false,
        priceLineVisible: false
      })

      series.setData(lineData)
      seriesRef.current.set(modelName, series)
      seriesModelMap.current.set(series, modelName)
      hasData = true
    })

    // Add observations series if visible and has data
    if (visibleModels.has('Observed') && observationData.length > 0) {
      const obsSeries = chart.addLineSeries({
        color: OBSERVED_COLOR,
        lineWidth: 3,
        title: '',
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerRadius: 6,
        crosshairMarkerBorderWidth: 2,
        crosshairMarkerBorderColor: OBSERVED_COLOR,
      })

      obsSeries.setData(observationData)
      seriesRef.current.set('Observed', obsSeries)
      seriesModelMap.current.set(obsSeries, 'Observed')
      hasData = true
    }

    // Add horizontal line for predicted peak temperature (consensus high)
    if (visibleModels.has('Predicted Peak') && models.length > 0) {
      const dailyHighs = models
        .filter(m => m.dailyHigh !== null)
        .map(m => m.dailyHigh!)

      if (dailyHighs.length > 0) {
        const consensusHigh = Math.round((dailyHighs.reduce((a, b) => a + b, 0) / dailyHighs.length) * 10) / 10

        // Create horizontal line by adding two points at the same Y value
        const stationMidnight = getStationMidnightUTC(target.date)
        const stationEndOfDay = stationMidnight + 24 * 60 * 60 * 1000

        const peakSeries = chart.addLineSeries({
          color: MODEL_AVG_COLOR,
          lineWidth: 1,
          lineStyle: 2, // Dashed
          lastValueVisible: true,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        })

        peakSeries.setData([
          { time: Math.floor(stationMidnight / 1000) as UTCTimestamp, value: consensusHigh },
          { time: Math.floor(stationEndOfDay / 1000) as UTCTimestamp, value: consensusHigh }
        ])

        seriesRef.current.set('Predicted Peak', peakSeries)
        seriesModelMap.current.set(peakSeries, 'Predicted Peak')
      }
    }

    // Set visible range to the full market day (24 hours in station's local timezone)
    if (hasData) {
      const stationMidnight = getStationMidnightUTC(target.date)
      const stationEndOfDay = stationMidnight + 24 * 60 * 60 * 1000

      try {
        chart.timeScale().setVisibleRange({
          from: Math.floor(stationMidnight / 1000) as UTCTimestamp,
          to: Math.floor(stationEndOfDay / 1000) as UTCTimestamp
        })
      } catch (e) {
        chart.timeScale().fitContent()
      }
    }
  }, [modelData, observationData, visibleModels, target.date, chartReady, theme, models, getStationMidnightUTC])

  // Handle crosshair move for custom tooltip
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !chartReady) return

    const handler = (param: MouseEventParams<Time>) => {
      const point = param.point
      if (!point || !param.time) {
        setHoverInfo(null)
        return
      }

      const entries: HoverEntry[] = []

      for (const [series, dataPoint] of Array.from(param.seriesData.entries())) {
        const lineSeries = series as ISeriesApi<'Line'>
        const modelName = seriesModelMap.current.get(lineSeries)
        if (!modelName) continue

        const value = dataPoint && 'value' in dataPoint ? dataPoint.value : undefined
        if (typeof value !== 'number' || !Number.isFinite(value)) continue

        let color = MODEL_COLORS[modelName] || '#888888'
        if (modelName === 'Observed') color = OBSERVED_COLOR
        if (modelName === 'Predicted Peak') color = MODEL_AVG_COLOR

        entries.push({
          model: modelName,
          value,
          color
        })
      }

      if (entries.length === 0) {
        setHoverInfo(null)
        return
      }

      // Sort: Observed first, then by value descending
      entries.sort((a, b) => {
        if (a.model === 'Observed') return -1
        if (b.model === 'Observed') return 1
        return b.value - a.value
      })

      // Format time in station's local timezone
      const timeValue = typeof param.time === 'number' ? param.time : 0
      const timeStr = formatLocalTime(timeValue)

      setHoverInfo({
        x: point.x,
        time: timeStr,
        entries
      })
    }

    chart.subscribeCrosshairMove(handler)
    return () => {
      chart.unsubscribeCrosshairMove(handler)
    }
  }, [chartReady, theme, formatLocalTime])

  const toggleModel = useCallback((modelName: string) => {
    setVisibleModels(prev => {
      const next = new Set(prev)
      if (next.has(modelName)) {
        next.delete(modelName)
      } else {
        next.add(modelName)
      }
      return next
    })
  }, [])

  const availableModels = Object.keys(modelData)
  const modelUpdatesByName = useMemo(() => {
    const byName = new Map<string, WeatherAnalysisResponse['modelUpdates'][number]>()
    for (const update of modelUpdates) {
      byName.set(update.model, update)
    }
    return byName
  }, [modelUpdates])

  const getNextRunTimestampMs = useCallback((updateInfo: WeatherAnalysisResponse['modelUpdates'][number]) => {
    if (updateInfo.nextRunAt) {
      const parsedAbsolute = Date.parse(updateInfo.nextRunAt)
      if (Number.isFinite(parsedAbsolute)) {
        return parsedAbsolute
      }
    }
    if (updateInfo.minutesUntilNext > 0) {
      return modelUpdateAnchorRef.current + updateInfo.minutesUntilNext * 60 * 1000
    }
    return null
  }, [])

  // Get predicted highs for the summary
  const predictedHighs = models
    .filter(m => m.dailyHigh !== null)
    .map(m => ({ model: m.name, high: m.dailyHigh! }))
    .sort((a, b) => b.high - a.high)

  return (
    <div className="analysis-chart-section">
      <div className="analysis-chart-header">
        <div className="analysis-chart-title">
          Model Forecast vs Observation
          <InfoTooltip text="Compares model forecasts with actual observations. Red line: actual METAR readings. Yellow dashed horizontal line: predicted peak (consensus daily high). Colored lines: individual weather model predictions." />
        </div>
      </div>

      {/* Predicted Daily Highs Summary */}
      {predictedHighs.length > 0 && (
        <div className="analysis-predicted-highs">
          <span className="predicted-highs-label">Predicted High:</span>
          {predictedHighs.slice(0, 4).map(({ model, high }) => (
            <span
              key={model}
              className="predicted-high-item"
              style={{ borderColor: MODEL_COLORS[model] || '#888' }}
            >
              {model}: {high.toFixed(1)}°{target.unit}
            </span>
          ))}
          {predictedHighs.length > 4 && (
            <span className="predicted-highs-more">+{predictedHighs.length - 4} more</span>
          )}
        </div>
      )}

      <div className="analysis-chart-wrap">
        <div ref={containerRef} className="analysis-chart-canvas" />
        {hoverInfo && hoverInfo.entries.length > 0 && (
          <div
            className="analysis-chart-tooltip"
            style={{
              left: Math.min(Math.max(hoverInfo.x + 12, 0), Math.max(0, sizeRef.current.width - 140)),
              top: 8
            }}
          >
            <div className="tooltip-time">{hoverInfo.time}</div>
            {hoverInfo.entries.map(entry => (
              <div
                key={entry.model}
                className="tooltip-entry"
                style={{ borderLeftColor: entry.color }}
              >
                <span className="tooltip-model">{entry.model}</span>
                <span className="tooltip-value">{entry.value.toFixed(1)}°</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="analysis-chart-legend">
        {/* Observed toggle first */}
        <button
          className={`analysis-legend-item ${visibleModels.has('Observed') ? 'active' : ''} ${!hasObservations ? 'disabled' : ''}`}
          onClick={() => hasObservations && toggleModel('Observed')}
          style={{
            borderColor: visibleModels.has('Observed') ? OBSERVED_COLOR : undefined,
            opacity: hasObservations ? 1 : 0.5
          }}
          disabled={!hasObservations}
        >
          <span className="analysis-legend-dot" style={{ background: OBSERVED_COLOR }} />
          <span className="analysis-legend-name">Observed</span>
          {!hasObservations && <span className="analysis-legend-run">(no data yet)</span>}
        </button>

        {/* Predicted Peak toggle */}
        <button
          className={`analysis-legend-item ${visibleModels.has('Predicted Peak') ? 'active' : ''}`}
          onClick={() => toggleModel('Predicted Peak')}
          style={{
            borderColor: visibleModels.has('Predicted Peak') ? MODEL_AVG_COLOR : undefined
          }}
        >
          <span className="analysis-legend-dot" style={{ background: MODEL_AVG_COLOR }} />
          <span className="analysis-legend-name">Predicted Peak</span>
        </button>

        {availableModels.map(modelName => {
          const color = MODEL_COLORS[modelName] || '#888888'
          const isVisible = visibleModels.has(modelName)
          const updateInfo = modelUpdatesByName.get(modelName)
          // Use API-provided dataAgeMinutes if available, otherwise calculate from lastRun
          const dataAgeMinutes = updateInfo?.dataAgeMinutes ?? (updateInfo ? getDataAge(updateInfo.lastRun) : null)
          const nextRunCountdown = updateInfo ? formatCountdownFromMs(getNextRunTimestampMs(updateInfo), nowMs) : '--'

          return (
            <button
              key={modelName}
              className={`analysis-legend-item ${isVisible ? 'active' : ''}`}
              onClick={() => toggleModel(modelName)}
              style={{ borderColor: isVisible ? color : undefined }}
              title={updateInfo ? `Data: ${formatDuration(dataAgeMinutes!)} old | Next run: ${nextRunCountdown} (${updateInfo.nextRun})` : undefined}
            >
              <span className="analysis-legend-dot" style={{ background: color }} />
              <span className="analysis-legend-name">{modelName}</span>
              {updateInfo && (
                <span className="analysis-legend-timing">{formatDuration(dataAgeMinutes!)} → {nextRunCountdown}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
