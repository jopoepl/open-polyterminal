import { useEffect, useRef, useState } from 'react'

export interface Trade {
  id: string
  asset: string
  conditionId: string
  side: 'BUY' | 'SELL'
  size: number
  price: number
  timestamp: string
  outcome: string
  marketTitle: string
  user: string
}

const POLL_INTERVAL_MS = 60_000

export function useTrades(conditionIds: string[]) {
  const [trades, setTrades] = useState<Trade[]>([])
  const [status, setStatus] = useState<'ok' | 'unavailable' | 'loading'>('loading')
  const abortRef = useRef<AbortController | null>(null)
  const conditionIdsKey = conditionIds.join(',')

  useEffect(() => {
    if (!conditionIds.length) {
      setTrades([])
      setStatus('loading')
      return
    }

    const fetchTrades = async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const params = new URLSearchParams()
        params.set('conditionIds', conditionIds.join(','))
        const res = await fetch(`/api/trades?${params.toString()}`, { signal: controller.signal })
        if (!res.ok) {
          if (!controller.signal.aborted) setStatus('unavailable')
          return
        }
        const json = await res.json()
        if (!controller.signal.aborted) {
          setTrades(json.trades || [])
          setStatus(json.status || 'ok')
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('useTrades fetch error', err)
          setStatus('unavailable')
        }
      }
    }

    fetchTrades()

    const interval = setInterval(fetchTrades, POLL_INTERVAL_MS)

    return () => {
      clearInterval(interval)
      abortRef.current?.abort()
    }
  }, [conditionIdsKey])

  return { trades, status }
}
