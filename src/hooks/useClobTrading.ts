import { useMemo } from 'react'

// Stub implementation - trading not yet enabled
// Will be implemented when wallet integration is added

export interface TradingOpenOrder {
  orderId: string
  side: 'BUY' | 'SELL'
  tokenId: string
  outcome: string
  status: string
  price: number
  size: number
  matchedSize: number
  createdAt: string
}

export interface TradeActionResult {
  success: boolean
  orderId?: string
  status?: string
  message?: string
  raw?: unknown
}

interface UseClobTradingParams {
  address: string | null
  signer: unknown
  enabled: boolean
}

interface UseClobTradingResult {
  clientReady: boolean
  initializing: boolean
  actionLoading: boolean
  error: string | null
  openOrders: TradingOpenOrder[]
  refreshOpenOrders: () => Promise<void>
  placeLimitOrder: (args: {
    tokenId: string
    side: 'BUY' | 'SELL'
    price: number
    size: number
    postOnly?: boolean
  }) => Promise<TradeActionResult>
  placeMarketOrder: (args: {
    tokenId: string
    side: 'BUY' | 'SELL'
    amount: number
  }) => Promise<TradeActionResult>
  cancelOrder: (orderId: string) => Promise<TradeActionResult>
}

export function useClobTrading(_params: UseClobTradingParams): UseClobTradingResult {
  return useMemo(() => ({
    clientReady: false,
    initializing: false,
    actionLoading: false,
    error: null,
    openOrders: [],
    refreshOpenOrders: async () => {},
    placeLimitOrder: async () => ({ success: false, message: 'Trading not yet enabled' }),
    placeMarketOrder: async () => ({ success: false, message: 'Trading not yet enabled' }),
    cancelOrder: async () => ({ success: false, message: 'Trading not yet enabled' })
  }), [])
}
