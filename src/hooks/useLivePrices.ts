import { useEffect, useRef, useState } from 'react'

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market'
const RECONNECT_DELAY_MS = 3000
const MAX_RETRIES = 5

export interface PriceLevel {
  price: number
  size: number
}

export interface LivePrice {
  bestAsk: number
  bestBid: number
  bestAskSize: number
  bestBidSize: number
  bids: PriceLevel[]
  asks: PriceLevel[]
}

export function useLivePrices(tokenIds: string[], enabled: boolean) {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeSubs = useRef<string>('')
  const bookRef = useRef<Record<string, { bids: Record<string, number>; asks: Record<string, number> }>>({})
  const retriesRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cleanedUpRef = useRef(false)

  useEffect(() => {
    if (!enabled || tokenIds.length === 0) return

    const subKey = [...tokenIds].sort().join(',')
    if (wsRef.current?.readyState === WebSocket.OPEN && activeSubs.current === subKey) return

    activeSubs.current = subKey
    retriesRef.current = 0
    cleanedUpRef.current = false

    const connect = () => {
      if (cleanedUpRef.current) return

      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        retriesRef.current = 0
        ws.send(JSON.stringify({ type: 'market', assets_ids: tokenIds }))
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping')
        }, 5000)
      }

      ws.onmessage = (event) => {
        const raw = event.data
        if (raw === 'PONG' || !raw.startsWith('{')) return

        try {
          const msg = JSON.parse(raw)

          if (msg.event_type === 'book') {
            const tId = msg.asset_id
            bookRef.current[tId] = { bids: {}, asks: {} }
            msg.bids.forEach((b: any) => (bookRef.current[tId].bids[b.price] = parseFloat(b.size)))
            msg.asks.forEach((a: any) => (bookRef.current[tId].asks[a.price] = parseFloat(a.size)))

            const bestBid = msg.bids.length ? msg.bids[msg.bids.length - 1] : { price: '0', size: '0' }
            const bestAsk = msg.asks.length ? msg.asks[0] : { price: '0', size: '0' }

            // Convert book to sorted arrays
            const bids = Object.entries(bookRef.current[tId].bids)
              .map(([price, size]) => ({ price: parseFloat(price), size }))
              .sort((a, b) => b.price - a.price) // high to low
            const asks = Object.entries(bookRef.current[tId].asks)
              .map(([price, size]) => ({ price: parseFloat(price), size }))
              .sort((a, b) => a.price - b.price) // low to high

            setPrices((prev) => ({
              ...prev,
              [tId]: {
                bestAsk: parseFloat(bestAsk.price),
                bestBid: parseFloat(bestBid.price),
                bestAskSize: parseFloat(bestAsk.size),
                bestBidSize: parseFloat(bestBid.size),
                bids,
                asks
              }
            }))
          }

          if (msg.event_type === 'price_change') {
            msg.price_changes.forEach((p: any) => {
              const tId = p.asset_id
              if (!bookRef.current[tId]) bookRef.current[tId] = { bids: {}, asks: {} }
              const map = p.side === 'BUY' ? bookRef.current[tId].bids : bookRef.current[tId].asks
              const size = parseFloat(p.size)
              if (size === 0) delete map[p.price]
              else map[p.price] = size

              const bestAskSize = bookRef.current[tId].asks[p.best_ask] || 0
              const bestBidSize = bookRef.current[tId].bids[p.best_bid] || 0

              // Convert book to sorted arrays
              const bids = Object.entries(bookRef.current[tId].bids)
                .map(([price, sz]) => ({ price: parseFloat(price), size: sz }))
                .sort((a, b) => b.price - a.price)
              const asks = Object.entries(bookRef.current[tId].asks)
                .map(([price, sz]) => ({ price: parseFloat(price), size: sz }))
                .sort((a, b) => a.price - b.price)

              setPrices((prev) => ({
                ...prev,
                [tId]: {
                  bestAsk: parseFloat(p.best_ask),
                  bestBid: parseFloat(p.best_bid),
                  bestAskSize,
                  bestBidSize,
                  bids,
                  asks
                }
              }))
            })
          }
        } catch (e) {
          console.error(e)
        }
      }

      ws.onclose = () => {
        if (pingRef.current) clearInterval(pingRef.current)
        if (!cleanedUpRef.current && retriesRef.current < MAX_RETRIES) {
          retriesRef.current++
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      cleanedUpRef.current = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
      if (pingRef.current) clearInterval(pingRef.current)
    }
  }, [enabled, tokenIds])

  return prices
}
