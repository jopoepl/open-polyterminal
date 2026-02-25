import type { NextApiRequest, NextApiResponse } from 'next'

const DATA_API = 'https://data-api.polymarket.com'
const REQUEST_TIMEOUT_MS = 6000
const CACHE_TTL_MS = 60 * 1000

interface Trade {
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

interface CacheEntry {
  trades: Trade[]
  ts: number
}

const SERVER_CACHE = new Map<string, CacheEntry>()

function parseTimestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000
    return new Date(ms).toISOString()
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''

    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) {
      const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000
      return new Date(ms).toISOString()
    }

    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
    return trimmed
  }

  return ''
}

function parseTrade(raw: any): Trade {
  const user =
    raw.proxyWallet ||
    raw.user ||
    raw.owner ||
    raw.trader ||
    raw.taker ||
    raw.taker_address ||
    raw.maker ||
    raw.maker_address ||
    raw.proxy_wallet ||
    raw.wallet ||
    raw.address ||
    ''

  return {
    id: raw.id || '',
    asset: raw.asset || raw.asset_id || raw.token_id || '',
    conditionId: raw.conditionId || raw.condition_id || '',
    side: raw.side === 'SELL' ? 'SELL' : 'BUY',
    size: typeof raw.size === 'number' ? raw.size : parseFloat(raw.size || '0'),
    price: typeof raw.price === 'number' ? raw.price : parseFloat(raw.price || '0'),
    timestamp: parseTimestamp(raw.timestamp || raw.created_at || raw.match_time),
    outcome: raw.outcome || raw.outcome_name || raw.title || raw.market_slug || '',
    marketTitle: raw.title || raw.question || raw.market_title || raw.slug || '',
    user: typeof user === 'string' ? user : '',
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate')

  // Support multiple conditionIds
  const conditionIdsParam = typeof req.query.conditionIds === 'string' ? req.query.conditionIds.trim() : ''
  const conditionIds = conditionIdsParam ? conditionIdsParam.split(',').filter(Boolean) : []

  // Legacy single params
  const tokenId = typeof req.query.tokenId === 'string' ? req.query.tokenId.trim() : ''
  const conditionId = typeof req.query.conditionId === 'string' ? req.query.conditionId.trim() : ''
  if (conditionId && !conditionIds.length) conditionIds.push(conditionId)

  if (!tokenId && !conditionIds.length) {
    return res.status(400).json({ error: 'conditionIds or tokenId is required' })
  }

  const cacheKey = conditionIds.length ? conditionIds.sort().join(',') : tokenId
  const now = Date.now()
  const cached = SERVER_CACHE.get(cacheKey)
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return res.status(200).json({ trades: cached.trades, status: 'ok' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    let allTrades: Trade[] = []

    if (conditionIds.length) {
      // Fetch trades for all conditionIds in parallel
      const fetches = conditionIds.map(async (cid) => {
        const url = `${DATA_API}/trades?market=${encodeURIComponent(cid)}&limit=100`
        const upstream = await fetch(url, { signal: controller.signal })
        if (!upstream.ok) return []
        const json = await upstream.json()
        const rawTrades: any[] = Array.isArray(json) ? json : json.trades || json.data || []
        return rawTrades.map(parseTrade)
      })
      const results = await Promise.all(fetches)
      allTrades = results.flat()
    } else {
      const url = `${DATA_API}/trades?asset_id=${encodeURIComponent(tokenId)}&limit=500`
      const upstream = await fetch(url, { signal: controller.signal })
      if (!upstream.ok) {
        return res.status(200).json({ trades: cached?.trades || [], status: 'unavailable' })
      }
      const json = await upstream.json()
      const rawTrades: any[] = Array.isArray(json) ? json : json.trades || json.data || []
      allTrades = rawTrades.map(parseTrade).filter((t) => t.asset === tokenId)
    }

    const trades = allTrades
      .sort((a, b) => {
        const ta = Date.parse(a.timestamp)
        const tb = Date.parse(b.timestamp)
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
      })
      .slice(0, 100)

    SERVER_CACHE.set(cacheKey, { trades, ts: now })
    return res.status(200).json({ trades, status: 'ok' })
  } catch {
    return res.status(200).json({ trades: cached?.trades || [], status: 'unavailable' })
  } finally {
    clearTimeout(timeout)
  }
}
