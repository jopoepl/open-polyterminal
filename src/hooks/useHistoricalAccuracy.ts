import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  HistoricalAccuracyResponse,
  HistoricalPeriod,
  HistoricalScoringMode
} from '@/lib/accuracy/types'

interface UseHistoricalAccuracyOptions {
  city: string | null
  unit: 'C' | 'F'
  period: HistoricalPeriod
  scoringMode: HistoricalScoringMode
  enabled?: boolean
}

interface UseHistoricalAccuracyResult {
  data: HistoricalAccuracyResponse | null
  loading: boolean
  error: Error | null
  refresh: () => void
  lastUpdated: Date | null
}

const CACHE = new Map<string, { ts: number; data: HistoricalAccuracyResponse }>()
const CACHE_TTL_MS = 45 * 1000

export function useHistoricalAccuracy({
  city,
  unit,
  period,
  scoringMode,
  enabled = true,
}: UseHistoricalAccuracyOptions): UseHistoricalAccuracyResult {
  const [data, setData] = useState<HistoricalAccuracyResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async (isInitial: boolean = false) => {
    if (!enabled || !city) {
      setData(null)
      setError(null)
      return
    }

    const cacheKey = `${city}-${period}-${unit}-${scoringMode}`
    if (isInitial) {
      const cached = CACHE.get(cacheKey)
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        setData(cached.data)
        setLastUpdated(new Date(cached.ts))
        return
      }
    }

    if (controllerRef.current) controllerRef.current.abort()
    controllerRef.current = new AbortController()

    setError(null)
    setLoading(true)

    try {
      const params = new URLSearchParams({ city, period, unit, scoring: scoringMode })
      const response = await fetch(`/api/historical-accuracy?${params.toString()}`, {
        signal: controllerRef.current.signal,
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`Historical accuracy request failed (${response.status})`)
      }

      const json = await response.json() as HistoricalAccuracyResponse
      if (controllerRef.current.signal.aborted) return

      setData(json)
      setLastUpdated(new Date())
      CACHE.set(cacheKey, { ts: Date.now(), data: json })
    } catch (err: any) {
      if (controllerRef.current.signal.aborted || err?.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error('Historical accuracy request failed'))
    } finally {
      if (!controllerRef.current.signal.aborted) {
        setLoading(false)
      }
    }
  }, [city, period, unit, scoringMode, enabled])

  useEffect(() => {
    void fetchData(true)
    return () => controllerRef.current?.abort()
  }, [fetchData])

  return {
    data,
    loading,
    error,
    refresh: () => void fetchData(false),
    lastUpdated,
  }
}
