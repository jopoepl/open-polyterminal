import type { NextApiRequest, NextApiResponse } from 'next'

const CLOB_API = 'https://clob.polymarket.com'
const REQUEST_TIMEOUT_MS = 6000
const CACHE_TTL_MS = 30 * 1000
const EVICTION_AGE_MS = 5 * 60 * 1000
const RATE_LIMIT_BACKOFF_MS = 10 * 1000

interface PriceLevel {
  price: number
  size: number
}

interface OrderbookEntry {
  bestBid: number
  bestAsk: number
  bestBidSize: number
  bestAskSize: number
  bids: PriceLevel[]
  asks: PriceLevel[]
}

interface CacheEntry {
  data: OrderbookEntry
  ts: number
}

const SERVER_CACHE = new Map<string, CacheEntry>()
const IN_FLIGHT = new Set<string>()
const RATE_LIMITED = new Map<string, number>()

let lastEviction = Date.now()

function evictStale() {
  const now = Date.now()
  if (now - lastEviction < 60_000) return
  lastEviction = now
  for (const [key, entry] of SERVER_CACHE) {
    if (now - entry.ts > EVICTION_AGE_MS) SERVER_CACHE.delete(key)
  }
}

function parseTokenIds(input: string | string[] | undefined): string[] {
  if (!input) return []
  if (Array.isArray(input)) return input.flatMap((v) => v.split(',').map((s) => s.trim())).filter(Boolean)
  return input.split(',').map((s) => s.trim()).filter(Boolean)
}

function aggregateByPrice(orders: Array<{ price: string; size: string }>): PriceLevel[] {
  const map = new Map<number, number>()
  for (const order of orders) {
    const price = parseFloat(order.price)
    const size = parseFloat(order.size)
    map.set(price, (map.get(price) || 0) + size)
  }
  return Array.from(map.entries()).map(([price, size]) => ({ price, size }))
}

function parseBook(data: any): OrderbookEntry {
  const rawBids: Array<{ price: string; size: string }> = data.bids || []
  const rawAsks: Array<{ price: string; size: string }> = data.asks || []

  // Aggregate orders at same price, then sort
  const bids: PriceLevel[] = aggregateByPrice(rawBids)
    .sort((a, b) => b.price - a.price) // high to low (best bid first)

  const asks: PriceLevel[] = aggregateByPrice(rawAsks)
    .sort((a, b) => a.price - b.price) // low to high (best ask first)

  // Best bid/ask from sorted arrays (most reliable)
  const bestBid = bids[0] || { price: 0, size: 0 }
  const bestAsk = asks[0] || { price: 0, size: 0 }

  return {
    bestBid: bestBid.price,
    bestAsk: bestAsk.price,
    bestBidSize: bestBid.size,
    bestAskSize: bestAsk.size,
    bids: bids.slice(0, 20),
    asks: asks.slice(0, 20),
  }
}

async function fetchBook(tokenId: string): Promise<OrderbookEntry | null> {
  const now = Date.now()

  const rateLimitedUntil = RATE_LIMITED.get(tokenId)
  if (rateLimitedUntil && now < rateLimitedUntil) return null

  const cached = SERVER_CACHE.get(tokenId)
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data

  if (IN_FLIGHT.has(tokenId)) return cached?.data ?? null
  IN_FLIGHT.add(tokenId)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(`${CLOB_API}/book?token_id=${tokenId}`, { signal: controller.signal })

    if (res.status === 429) {
      RATE_LIMITED.set(tokenId, now + RATE_LIMIT_BACKOFF_MS)
      return cached?.data ?? null
    }

    if (!res.ok) return cached?.data ?? null

    const json = await res.json()
    const entry = parseBook(json)
    SERVER_CACHE.set(tokenId, { data: entry, ts: now })
    return entry
  } catch {
    return cached?.data ?? null
  } finally {
    clearTimeout(timeout)
    IN_FLIGHT.delete(tokenId)
  }
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let index = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }).map(async () => {
    while (index < items.length) {
      const current = index++
      results[current] = await fn(items[current])
    }
  })

  await Promise.all(workers)
  return results
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate')

  const tokenIds = parseTokenIds(req.query.tokenIds)

  if (!tokenIds.length) {
    return res.status(400).json({ error: 'tokenIds is required' })
  }

  evictStale()

  try {
    const results = await mapWithLimit(tokenIds, 4, async (tokenId) => {
      const book = await fetchBook(tokenId)
      return { tokenId, book }
    })

    const books: Record<string, OrderbookEntry> = {}
    for (const { tokenId, book } of results) {
      if (book) books[tokenId] = book
    }

    return res.status(200).json({ books })
  } catch (error) {
    console.error('orderbook error', error)
    return res.status(500).json({ error: 'Failed to fetch orderbook' })
  }
}
