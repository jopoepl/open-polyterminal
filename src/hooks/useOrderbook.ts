import { useEffect, useRef, useState } from 'react'

export interface PriceLevel {
  price: number
  size: number
}

export interface OrderbookData {
  bestBid: number
  bestAsk: number
  bestBidSize: number
  bestAskSize: number
  bids: PriceLevel[]
  asks: PriceLevel[]
}

const POLL_INTERVAL_MS = 30_000

export function useOrderbook(tokenIds: string[]) {
  const [data, setData] = useState<Record<string, OrderbookData>>({})
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const prevIdsRef = useRef('')

  useEffect(() => {
    if (!tokenIds.length) {
      setData({})
      return
    }

    const idsKey = [...tokenIds].sort().join(',')
    const idsChanged = idsKey !== prevIdsRef.current
    prevIdsRef.current = idsKey

    const fetchBooks = async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        setLoading(true)
        const params = new URLSearchParams({ tokenIds: tokenIds.join(',') })
        const res = await fetch(`/api/orderbook?${params.toString()}`, { signal: controller.signal })
        if (!res.ok) return
        const json = await res.json()
        if (!controller.signal.aborted) {
          setData(json.books || {})
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') console.warn('useOrderbook fetch error', err)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    fetchBooks()

    const interval = setInterval(fetchBooks, POLL_INTERVAL_MS)

    return () => {
      clearInterval(interval)
      abortRef.current?.abort()
    }
  }, [tokenIds.sort().join(',')])

  return { data, loading }
}
