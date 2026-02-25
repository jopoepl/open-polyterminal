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
import type { HistoricalDailySeriesPoint, ModelAccuracyRow } from '@/lib/accuracy/types'
import InfoTooltip from './InfoTooltip'

interface HistoricalChartProps {
  dailySeries: HistoricalDailySeriesPoint[]
  rankings: ModelAccuracyRow[]
  theme: 'dark' | 'light'
}

interface HistoricalTooltipEntry {
  model: string
  value: number | null
  error: number | null
  mae: number | null
  color: string
}

interface HistoricalTooltipInfo {
  x: number
  date: string
  observed: number | null
  observedHighAt: string | null
  observationCount: number
  entries: HistoricalTooltipEntry[]
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

function toUtcTimestamp(dateStr: string): UTCTimestamp {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000) as UTCTimestamp
}

export default function HistoricalChart({ dailySeries, rankings, theme }: HistoricalChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<Array<ISeriesApi<'Line'>>>([])
  const sizeRef = useRef<{ width: number }>({ width: 600 })
  const [tooltipInfo, setTooltipInfo] = useState<HistoricalTooltipInfo | null>(null)

  const rankingsByModel = useMemo(() => {
    const byModel = new Map<string, ModelAccuracyRow>()
    for (const row of rankings) {
      byModel.set(row.model, row)
    }
    return byModel
  }, [rankings])

  const dailyByDate = useMemo(() => {
    const byDate = new Map<string, HistoricalDailySeriesPoint>()
    for (const row of dailySeries) {
      byDate.set(row.date, row)
    }
    return byDate
  }, [dailySeries])

  const topModels = useMemo(() => {
    const ranked = [...rankings].sort((a, b) => {
      const rankA = a.rank ?? Number.POSITIVE_INFINITY
      const rankB = b.rank ?? Number.POSITIVE_INFINITY
      if (rankA !== rankB) return rankA - rankB
      return b.sampleCount - a.sampleCount
    })
    return ranked.filter(row => row.sampleCount > 0).slice(0, 5).map(row => row.model)
  }, [rankings])

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
        secondsVisible: false
      },
      width: containerRef.current.clientWidth || 600,
      height: 300,
    })

    chartRef.current = chart
    sizeRef.current.width = containerRef.current.clientWidth || 600

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
      seriesRef.current = []
      setTooltipInfo(null)
    }
  }, [theme])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    for (const series of seriesRef.current) {
      chart.removeSeries(series)
    }
    seriesRef.current = []

    const observedData = dailySeries
      .filter(point => point.observedHigh !== null)
      .map(point => ({ time: toUtcTimestamp(point.date), value: point.observedHigh as number }))

    if (observedData.length > 0) {
      const observedSeries = chart.addLineSeries({
        color: '#ff6b6b',
        lineWidth: 3,
        title: 'Observed',
        lastValueVisible: true,
        priceLineVisible: false,
      })
      observedSeries.setData(observedData)
      seriesRef.current.push(observedSeries)
    }

    for (const model of topModels) {
      const modelData = dailySeries
        .map(point => {
          const match = point.models.find(value => value.model === model)
          if (!match || match.predictedHigh === null) return null
          return { time: toUtcTimestamp(point.date), value: match.predictedHigh }
        })
        .filter((value): value is { time: UTCTimestamp; value: number } => value !== null)

      if (modelData.length === 0) continue

      const series = chart.addLineSeries({
        color: MODEL_COLORS[model] || '#8fa2b7',
        lineWidth: 2,
        lineStyle: 2,
        title: model,
        lastValueVisible: false,
        priceLineVisible: false,
      })

      series.setData(modelData)
      seriesRef.current.push(series)
    }

    chart.timeScale().fitContent()
  }, [dailySeries, topModels])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const handler = (param: MouseEventParams<Time>) => {
      const point = param.point
      if (!point || !param.time) {
        setTooltipInfo(null)
        return
      }

      const timestamp = typeof param.time === 'number' ? param.time : null
      if (timestamp === null) {
        setTooltipInfo(null)
        return
      }

      const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
      const day = dailyByDate.get(date)
      if (!day) {
        setTooltipInfo(null)
        return
      }

      const entries: HistoricalTooltipEntry[] = topModels.map(model => {
        const row = day.models.find(value => value.model === model)
        const ranking = rankingsByModel.get(model)
        return {
          model,
          value: row?.predictedHigh ?? null,
          error: row?.error ?? null,
          mae: ranking?.mae ?? null,
          color: MODEL_COLORS[model] || '#8fa2b7',
        }
      })

      setTooltipInfo({
        x: point.x,
        date,
        observed: day.observedHigh,
        observedHighAt: day.observedHighAt,
        observationCount: day.observationCount,
        entries,
      })
    }

    chart.subscribeCrosshairMove(handler)
    return () => chart.unsubscribeCrosshairMove(handler)
  }, [dailyByDate, topModels, rankingsByModel])

  const formatTemp = (value: number | null) => (value === null ? '--' : `${value.toFixed(1)}°`)
  const formatSignedTemp = (value: number | null) => {
    if (value === null) return '--'
    const prefix = value > 0 ? '+' : ''
    return `${prefix}${value.toFixed(1)}°`
  }
  const formatObservedAt = (value: string | null) => {
    if (!value) return '--'
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return '--'
    return parsed.toISOString().slice(11, 16) + 'Z'
  }

  return (
    <div className="historical-chart-section">
      <div className="historical-section-title">
        Peak Comparison Chart
        <InfoTooltip text="Red line is observed METAR daily peak. Model lines are T-1 forecasted peaks for each day. Top 5 ranked models are shown." />
      </div>
      <div className="historical-chart-wrap">
        <div ref={containerRef} className="historical-chart-canvas" />
        {tooltipInfo && (
          <div
            className="historical-chart-tooltip"
            style={{
              left: Math.min(Math.max(tooltipInfo.x + 12, 0), Math.max(0, sizeRef.current.width - 220)),
              top: 8,
            }}
          >
            <div className="historical-tooltip-time">{tooltipInfo.date}</div>
            <div className="historical-tooltip-entry observed">
              <span className="historical-tooltip-model">Observed</span>
              <span className="historical-tooltip-value">{formatTemp(tooltipInfo.observed)}</span>
            </div>
            <div className="historical-tooltip-sub">
              peak at {formatObservedAt(tooltipInfo.observedHighAt)} • {tooltipInfo.observationCount} obs
            </div>
            {tooltipInfo.entries.map(entry => (
              <div
                key={entry.model}
                className="historical-tooltip-entry"
                style={{ borderLeftColor: entry.color }}
              >
                <span className="historical-tooltip-model">{entry.model}</span>
                <span className="historical-tooltip-value">
                  {formatTemp(entry.value)} | err {formatSignedTemp(entry.error)} | MAE {formatTemp(entry.mae)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="historical-chart-legend">
          <span className="historical-legend-item">
            <span className="historical-legend-dot observed" />
            Observed Peak
          </span>
          {topModels.map(model => (
            <span key={model} className="historical-legend-item">
              <span className="historical-legend-dot" style={{ background: MODEL_COLORS[model] || '#8fa2b7' }} />
              {model}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
