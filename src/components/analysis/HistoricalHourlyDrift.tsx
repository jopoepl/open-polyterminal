import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import type { HistoricalHourlyWindow, ModelAccuracyRow } from '@/lib/accuracy/types'
import InfoTooltip from './InfoTooltip'

interface HistoricalHourlyDriftProps {
  hourly: HistoricalHourlyWindow
  rankings: ModelAccuracyRow[]
  unit: 'C' | 'F'
  theme: 'dark' | 'light'
}

interface TooltipEntry {
  model: string
  forecast: number | null
  error: number | null
  color: string
}

interface TooltipInfo {
  x: number
  hour: number
  observed: number | null
  entries: TooltipEntry[]
}

const MODEL_COLORS: Record<string, string> = {
  GFS: '#39d38a',
  ECMWF: '#f472b6',
  ICON: '#38bdf8',
  ARPEGE: '#fb923c',
  UKMO: '#22d3d3',
  GEM: '#a3e635',
  JMA: '#e879f9',
}

function toTs(date: string, hour: number): UTCTimestamp {
  return Math.floor(new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`).getTime() / 1000) as UTCTimestamp
}

function formatDayChip(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`
}

function formatTemp(value: number | null, unit: 'C' | 'F'): string {
  if (value === null) return '--'
  return `${value.toFixed(1)}°${unit}`
}

function formatSignedTemp(value: number | null, unit: 'C' | 'F'): string {
  if (value === null) return '--'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}°${unit}`
}

export default function HistoricalHourlyDrift({ hourly, rankings, unit, theme }: HistoricalHourlyDriftProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const observedSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const forecastSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const sizeRef = useRef<{ width: number }>({ width: 600 })
  const initializedModelsRef = useRef(false)
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null)

  const dayOptions = useMemo(() => hourly.series.map(day => day.date), [hourly.series])
  const [selectedDate, setSelectedDate] = useState(() => dayOptions[dayOptions.length - 1] || '')

  const rankedModels = useMemo(() => {
    const sorted = [...rankings].sort((a, b) => {
      const rankA = a.rank ?? Number.POSITIVE_INFINITY
      const rankB = b.rank ?? Number.POSITIVE_INFINITY
      if (rankA !== rankB) return rankA - rankB
      return b.sampleCount - a.sampleCount
    })
    return sorted.filter(row => row.sampleCount > 0).map(row => row.model)
  }, [rankings])

  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (dayOptions.length > 0 && (!selectedDate || !dayOptions.includes(selectedDate))) {
      setSelectedDate(dayOptions[dayOptions.length - 1])
    }
  }, [dayOptions, selectedDate])

  useEffect(() => {
    if (initializedModelsRef.current) return
    if (rankedModels.length === 0) return
    setSelectedModels(new Set(rankedModels.slice(0, 7)))
    initializedModelsRef.current = true
  }, [rankedModels])

  const selectedDay = useMemo(() => (
    hourly.series.find(day => day.date === selectedDate) || null
  ), [hourly.series, selectedDate])

  const selectedModelList = useMemo(() => {
    return rankedModels.filter(model => selectedModels.has(model))
  }, [rankedModels, selectedModels])

  const selectedModelStats = useMemo(() => {
    if (!selectedDay) return []
    return selectedModelList
      .map(model => selectedDay.models.find(entry => entry.model === model) || null)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  }, [selectedDay, selectedModelList])

  const pointByTs = useMemo(() => {
    const map = new Map<number, { hour: number; observed: number | null; entries: TooltipEntry[] }>()
    if (!selectedDay) return map

    for (let hour = 0; hour < 24; hour++) {
      let observed: number | null = null
      const entries: TooltipEntry[] = []

      for (const model of selectedModelList) {
        const modelData = selectedDay.models.find(entry => entry.model === model)
        const point = modelData?.points.find(entry => entry.hour === hour)
        if (observed === null && point?.observed !== null && point?.observed !== undefined) {
          observed = point.observed
        }
        entries.push({
          model,
          forecast: point?.forecast ?? null,
          error: point?.error ?? null,
          color: MODEL_COLORS[model] || '#8fa2b7',
        })
      }

      map.set(toTs(selectedDay.date, hour), { hour, observed, entries })
    }

    return map
  }, [selectedDay, selectedModelList])

  useEffect(() => {
    if (!containerRef.current) return

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
        tickMarkFormatter: (time: UTCTimestamp) => {
          const d = new Date(Number(time) * 1000)
          return `${String(d.getUTCHours()).padStart(2, '0')}:00`
        },
      },
      width: containerRef.current.clientWidth || 600,
      height: 260,
    })

    chartRef.current = chart
    sizeRef.current.width = containerRef.current.clientWidth || 600

    const observedSeries = chart.addLineSeries({
      color: '#ff6b6b',
      lineWidth: 3,
      title: 'Observed',
      priceLineVisible: false,
      lastValueVisible: true,
    })
    observedSeriesRef.current = observedSeries

    const observer = new ResizeObserver(() => {
      const width = containerRef.current?.clientWidth || 600
      sizeRef.current.width = width
      chart.applyOptions({ width })
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      observedSeriesRef.current = null
      forecastSeriesRef.current.clear()
      setTooltip(null)
    }
  }, [theme])

  useEffect(() => {
    const chart = chartRef.current
    const observedSeries = observedSeriesRef.current
    if (!chart || !observedSeries || !selectedDay) return

    for (const series of forecastSeriesRef.current.values()) {
      chart.removeSeries(series)
    }
    forecastSeriesRef.current.clear()

    // Observed comes from any model row (shared observation stream)
    const firstModel = selectedDay.models[0]
    const observedData = (firstModel?.points || [])
      .filter(point => point.observed !== null)
      .map(point => ({ time: toTs(selectedDay.date, point.hour), value: point.observed as number }))

    observedSeries.setData(observedData)

    for (const model of selectedModelList) {
      const modelData = selectedDay.models.find(entry => entry.model === model)
      if (!modelData) continue

      const forecastData = modelData.points
        .filter(point => point.forecast !== null)
        .map(point => ({ time: toTs(selectedDay.date, point.hour), value: point.forecast as number }))

      if (forecastData.length === 0) continue

      const series = chart.addLineSeries({
        color: MODEL_COLORS[model] || '#8fa2b7',
        lineWidth: 2,
        lineStyle: 2,
        title: model,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      series.setData(forecastData)
      forecastSeriesRef.current.set(model, series)
    }

    const from = toTs(selectedDay.date, 0)
    const to = toTs(selectedDay.date, 23)
    chart.timeScale().setVisibleRange({ from, to })
  }, [selectedDay, selectedModelList])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const handler = (param: MouseEventParams<Time>) => {
      const point = param.point
      if (!point || !param.time) {
        setTooltip(null)
        return
      }

      const ts = typeof param.time === 'number' ? Number(param.time) : NaN
      if (!Number.isFinite(ts)) {
        setTooltip(null)
        return
      }

      const entry = pointByTs.get(ts)
      if (!entry) {
        setTooltip(null)
        return
      }

      setTooltip({
        x: point.x,
        hour: entry.hour,
        observed: entry.observed,
        entries: entry.entries,
      })
    }

    chart.subscribeCrosshairMove(handler)
    return () => chart.unsubscribeCrosshairMove(handler)
  }, [pointByTs])

  const toggleModel = (model: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev)
      if (next.has(model)) {
        next.delete(model)
      } else {
        next.add(model)
      }
      return next
    })
  }

  const selectAllModels = () => {
    setSelectedModels(new Set(rankedModels.slice(0, 7)))
  }

  if (!selectedDay) {
    return (
      <div className="historical-hourly-section">
        <div className="historical-section-title">Hourly Drift (T-1)</div>
        <div className="analysis-empty">No hourly comparison data available</div>
      </div>
    )
  }

  return (
    <div className="historical-hourly-section">
      <div className="historical-section-title">
        Hourly Drift (T-1 vs Observed)
        <InfoTooltip text="For each day, compares observed hourly temperatures with previous-day (T-1) forecast hourly temperatures. Persistent positive error means forecasts were too cold." />
      </div>

      <div className="historical-hourly-controls">
        <div className="historical-hourly-days">
          {dayOptions.map(date => (
            <button
              key={date}
              className={`historical-hourly-btn ${selectedDate === date ? 'active' : ''}`}
              onClick={() => setSelectedDate(date)}
            >
              {formatDayChip(date)}
            </button>
          ))}
        </div>
        <div className="historical-hourly-models">
          <button
            className={`historical-hourly-btn ${selectedModelList.length >= Math.min(7, rankedModels.length) ? 'active' : ''}`}
            onClick={selectAllModels}
          >
            ALL
          </button>
          {rankedModels.slice(0, 7).map(model => (
            <button
              key={model}
              className={`historical-hourly-btn model ${selectedModels.has(model) ? 'active' : ''}`}
              onClick={() => toggleModel(model)}
              style={{ borderColor: selectedModels.has(model) ? (MODEL_COLORS[model] || '#8fa2b7') : undefined }}
            >
              {model}
            </button>
          ))}
        </div>
      </div>

      <div className="historical-hourly-summary">
        <span>{selectedDay.date}</span>
        <span>{selectedModelList.length} models selected</span>
        <span>{selectedDay.observedHourCount} observed hours</span>
      </div>

      <div className="historical-hourly-metric-grid">
        {selectedModelStats.map(model => (
          <div key={model.model} className="historical-hourly-metric" style={{ borderLeftColor: MODEL_COLORS[model.model] || '#8fa2b7' }}>
            <span>{model.model}</span>
            <span>mean {formatSignedTemp(model.meanError, unit)}</span>
            <span>MAE {formatTemp(model.mae, unit)}</span>
            <span>{model.sampleCount}h</span>
          </div>
        ))}
      </div>

      <div className="historical-hourly-chart-wrap">
        <div ref={containerRef} className="historical-hourly-chart-canvas" />
        {tooltip && (
          <div
            className="historical-hourly-tooltip"
            style={{
              left: Math.min(Math.max(tooltip.x + 12, 0), Math.max(0, sizeRef.current.width - 260)),
              top: 8,
            }}
          >
            <div className="historical-tooltip-time">{String(tooltip.hour).padStart(2, '0')}:00</div>
            <div className="historical-tooltip-entry observed">
              <span className="historical-tooltip-model">Observed</span>
              <span className="historical-tooltip-value">{formatTemp(tooltip.observed, unit)}</span>
            </div>
            {tooltip.entries.map(entry => (
              <div key={entry.model} className="historical-tooltip-entry" style={{ borderLeftColor: entry.color }}>
                <span className="historical-tooltip-model">{entry.model}</span>
                <span className="historical-tooltip-value">
                  {formatTemp(entry.forecast, unit)} | err {formatSignedTemp(entry.error, unit)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
