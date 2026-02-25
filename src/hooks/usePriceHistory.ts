import { useEffect, useRef, useState } from 'react'
import type { TimeRange } from '@/types'

interface PriceHistoryPoint {
  t: number
  p: number
}

const HISTORY_CACHE = new Map<string, { data: PriceHistoryPoint[]; ts: number }>()
const CACHE_TTL_MS = 60 * 1000

export function usePriceHistory(range: TimeRange, tokenIds: string[]) {
  const [data, setData] = useState<Record<string, PriceHistoryPoint[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [fetchEpoch, setFetchEpoch] = useState(0)
  const tokenKey = [...tokenIds].sort().join(',')
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refetch = () => {
    // Clear cache for these tokens
    tokenIds.forEach((tokenId) => {
      HISTORY_CACHE.delete(`${range}:${tokenId}`)
    })
    setFetchEpoch((prev) => prev + 1)
  }

  useEffect(() => {
    if (!tokenIds.length) {
      setData({})
      return
    }

    const controller = new AbortController()
    const signal = controller.signal

    const fetchAll = async () => {
      setLoading(true)
      setError(null)

      try {
        const now = Date.now()
        const cachedData: Record<string, PriceHistoryPoint[]> = {}
        tokenIds.forEach((tokenId) => {
          const cacheKey = `${range}:${tokenId}`
          const cached = HISTORY_CACHE.get(cacheKey)
          if (cached && now - cached.ts < CACHE_TTL_MS) {
            cachedData[tokenId] = cached.data
          }
        })

        if (Object.keys(cachedData).length) {
          setData((prev) => ({ ...prev, ...cachedData }))
        }

        const params = new URLSearchParams()
        params.append('tokenIds', tokenIds.join(','))
        params.append('range', range)
        params.append('_ts', String(Date.now()))
        const batchRes = await fetch(`/api/price-history-batch?${params.toString()}`, { signal, cache: 'no-store' })
        if (!batchRes.ok) {
          throw new Error(`price-history-batch failed: ${batchRes.status}`)
        }
        const batchJson = await batchRes.json()
        const historyByToken = (batchJson.historyByToken || {}) as Record<string, PriceHistoryPoint[]>
        const pending = (batchJson.pending || []) as string[]

        Object.entries(historyByToken).forEach(([tokenId, history]) => {
          HISTORY_CACHE.set(`${range}:${tokenId}`, { data: history, ts: Date.now() })
        })

        if (!signal.aborted) {
          setData((prev) => ({ ...prev, ...historyByToken }))
        }

        if (pending.length && !signal.aborted) {
          if (retryRef.current) clearTimeout(retryRef.current)
          retryRef.current = setTimeout(() => {
            fetchAll().catch(() => {})
          }, 2000)
        }
      } catch (err: any) {
        if (!signal.aborted && err?.name !== 'AbortError') {
          console.error('Price history fetch failed', err)
          setError(err)
          // Auto-retry once after 3 seconds on failure
          if (retryRef.current) clearTimeout(retryRef.current)
          retryRef.current = setTimeout(() => {
            if (!signal.aborted) {
              fetchAll().catch(() => {})
            }
          }, 3000)
        }
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    fetchAll()

    return () => controller.abort()
  }, [range, tokenKey, fetchEpoch])

  return { data, loading, error, refetch }
}
