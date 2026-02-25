import { useEffect, useRef, useState, useCallback } from 'react'
import type { WeatherAnalysisResponse } from '@/pages/api/weather-analysis'

interface UseWeatherAnalysisOptions {
  city: string | null
  date: string | null
  unit: 'C' | 'F'
  refreshInterval?: number // in milliseconds
}

interface UseWeatherAnalysisResult {
  data: WeatherAnalysisResponse | null
  loading: boolean
  error: Error | null
  refresh: () => void
  lastUpdated: Date | null
}

const DATA_CACHE = new Map<string, { data: WeatherAnalysisResponse; ts: number }>()
const CACHE_TTL_MS = 30 * 1000 // 30 second cache for initial load

export function useWeatherAnalysis({
  city,
  date,
  unit,
  refreshInterval = 60000 // Default 1 minute refresh
}: UseWeatherAnalysisOptions): UseWeatherAnalysisResult {
  const [data, setData] = useState<WeatherAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async (isInitial: boolean = false) => {
    if (!city || !date) {
      setData(null)
      return
    }

    // Check cache for initial load
    const cacheKey = `${city}-${date}-${unit}`
    if (isInitial) {
      const cached = DATA_CACHE.get(cacheKey)
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        setData(cached.data)
        setLastUpdated(new Date(cached.ts))
        return
      }
    }

    // Cancel any in-flight request
    if (controllerRef.current) {
      controllerRef.current.abort()
    }

    const controller = new AbortController()
    controllerRef.current = controller

    if (isInitial) {
      setLoading(true)
    }
    setError(null)

    try {
      const params = new URLSearchParams({
        city,
        date,
        unit
      })

      const res = await fetch(`/api/weather-analysis?${params.toString()}`, {
        signal: controller.signal,
        cache: 'no-store'
      })

      if (!res.ok) {
        throw new Error(`Failed to fetch weather analysis: ${res.status}`)
      }

      const json = await res.json()

      if (!controller.signal.aborted) {
        setData(json)
        setLastUpdated(new Date())
        DATA_CACHE.set(cacheKey, { data: json, ts: Date.now() })
      }
    } catch (err: any) {
      if (!controller.signal.aborted && err?.name !== 'AbortError') {
        console.error('Weather analysis fetch failed', err)
        setError(err)
      }
    } finally {
      if (!controller.signal.aborted && isInitial) {
        setLoading(false)
      }
    }
  }, [city, date, unit])

  // Initial fetch and setup interval
  useEffect(() => {
    fetchData(true)

    // Setup auto-refresh
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => {
        fetchData(false)
      }, refreshInterval)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
      if (controllerRef.current) {
        controllerRef.current.abort()
      }
    }
  }, [fetchData, refreshInterval])

  const refresh = useCallback(() => {
    fetchData(false)
  }, [fetchData])

  return {
    data,
    loading,
    error,
    refresh,
    lastUpdated
  }
}

// Countdown hook for timers
export function useCountdown(targetMinutes: number | undefined): string {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    if (targetMinutes === undefined || targetMinutes <= 0) {
      setTimeLeft('--')
      return
    }

    const updateCountdown = () => {
      const totalSeconds = Math.max(0, Math.round(targetMinutes * 60))
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60

      if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`)
      } else if (minutes > 0) {
        setTimeLeft(`${minutes}m ${seconds}s`)
      } else {
        setTimeLeft(`${seconds}s`)
      }
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)

    return () => clearInterval(interval)
  }, [targetMinutes])

  return timeLeft
}

// Hook for real-time countdown that decrements
export function useLiveCountdown(initialMinutes: number | undefined): string {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (initialMinutes === undefined || initialMinutes <= 0) {
      setSecondsRemaining(null)
      return
    }

    setSecondsRemaining(Math.round(initialMinutes * 60))

    const interval = setInterval(() => {
      setSecondsRemaining(prev => {
        if (prev === null || prev <= 0) return 0
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [initialMinutes])

  if (secondsRemaining === null || secondsRemaining <= 0) {
    return '--'
  }

  const hours = Math.floor(secondsRemaining / 3600)
  const minutes = Math.floor((secondsRemaining % 3600) / 60)
  const seconds = secondsRemaining % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  } else {
    return `${seconds}s`
  }
}
