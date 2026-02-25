import { useCallback, useEffect, useRef, useState } from 'react'

export interface WalletPosition {
  tokenId: string
  conditionId: string
  title: string
  outcome: string
  size: number
  avgPrice: number
  currentPrice: number
  currentValue: number
  unrealizedPnl: number
  redeemable: boolean
  resolved: boolean
  resolutionStatus: 'active' | 'won' | 'lost'
}

export interface WalletTrade {
  id: string
  tokenId: string
  side: 'BUY' | 'SELL'
  price: number
  size: number
  amount: number
  outcome: string
  marketTitle: string
  timestamp: string
}

interface MonitorResponse {
  positions: WalletPosition[]
  trades: WalletTrade[]
  totalValue: number
  fetchedAt: string
  status: 'ok' | 'unavailable'
}

const POLL_INTERVAL_MS = 30_000

export function useWalletMonitor(address: string | null, enabled: boolean) {
  const [positions, setPositions] = useState<WalletPosition[]>([])
  const [trades, setTrades] = useState<WalletTrade[]>([])
  const [totalValue, setTotalValue] = useState(0)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'ok' | 'unavailable' | 'idle'>('idle')
  const abortRef = useRef<AbortController | null>(null)

  const fetchMonitor = useCallback(async () => {
    if (!address || !enabled) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams({
        address,
        limit: '30'
      })
      const response = await fetch(`/api/wallet-monitor?${params.toString()}`, {
        signal: controller.signal
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to fetch wallet monitor')
      }

      const json = await response.json() as MonitorResponse
      if (controller.signal.aborted) return

      setPositions(json.positions || [])
      setTrades(json.trades || [])
      setTotalValue(Number.isFinite(json.totalValue) ? json.totalValue : 0)
      setFetchedAt(json.fetchedAt || null)
      setStatus(json.status || 'ok')
    } catch (error: any) {
      if (error?.name === 'AbortError') return
      setError(error?.message || 'Failed to fetch wallet monitor')
      setStatus('unavailable')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [address, enabled])

  useEffect(() => {
    if (!enabled || !address) {
      abortRef.current?.abort()
      setPositions([])
      setTrades([])
      setTotalValue(0)
      setFetchedAt(null)
      setStatus('idle')
      setError(null)
      setLoading(false)
      return
    }

    void fetchMonitor()
    const interval = setInterval(() => {
      void fetchMonitor()
    }, POLL_INTERVAL_MS)

    return () => {
      clearInterval(interval)
      abortRef.current?.abort()
    }
  }, [address, enabled, fetchMonitor])

  return {
    positions,
    trades,
    totalValue,
    fetchedAt,
    status,
    loading,
    error,
    refresh: fetchMonitor
  }
}
