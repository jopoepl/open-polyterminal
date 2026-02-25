import type { NextApiRequest, NextApiResponse } from 'next'

const DATA_API = 'https://data-api.polymarket.com'
const REQUEST_TIMEOUT_MS = 9000
const CACHE_TTL_MS = 20 * 1000

interface MonitorPosition {
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

interface MonitorTrade {
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

interface CacheEntry {
  ts: number
  positions: MonitorPosition[]
  trades: MonitorTrade[]
  totalValue: number
}

const SERVER_CACHE = new Map<string, CacheEntry>()

function asNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value)
}

function parseTimestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000
    const parsed = new Date(ms)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
    return ''
  }

  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000
      const parsedNumeric = new Date(ms)
      if (!Number.isNaN(parsedNumeric.getTime())) return parsedNumeric.toISOString()
      return ''
    }

    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }

  return ''
}

function extractRows(json: any, kind: 'positions' | 'trades'): any[] {
  if (Array.isArray(json)) return json
  if (kind === 'positions' && Array.isArray(json?.positions)) return json.positions
  if (kind === 'trades' && Array.isArray(json?.trades)) return json.trades
  if (Array.isArray(json?.data)) return json.data
  return []
}

async function fetchJson(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      return { ok: false, json: null as any }
    }

    const json = await response.json()
    return { ok: true, json }
  } catch {
    return { ok: false, json: null as any }
  } finally {
    clearTimeout(timeout)
  }
}

function normalizePositions(raw: any[]): MonitorPosition[] {
  return raw
    .map((row) => {
      const tokenId = String(row?.asset || row?.asset_id || row?.token_id || '').trim()
      if (!tokenId) return null

      const size = asNumber(row?.size)
      const avgPrice = asNumber(row?.avgPrice ?? row?.avg_price)
      const currentPrice = asNumber(row?.curPrice ?? row?.current_price ?? row?.price ?? avgPrice)

      // For resolved markets, currentPrice tells us win/loss:
      // - currentPrice ≈ 1 means won (token redeemable for $1)
      // - currentPrice ≈ 0 means lost (token worthless)
      // Markets are resolved when price is at extremes (0 or 1)
      const isResolved = currentPrice <= 0.01 || currentPrice >= 0.99

      let resolutionStatus: 'active' | 'won' | 'lost' = 'active'
      if (isResolved) {
        resolutionStatus = currentPrice >= 0.99 ? 'won' : 'lost'
      }
      const resolved = isResolved

      return {
        tokenId,
        conditionId: String(row?.conditionId || row?.condition_id || '').trim(),
        title: String(row?.title || row?.question || row?.market_title || 'Unknown market'),
        outcome: String(row?.outcome || row?.outcome_name || ''),
        size,
        avgPrice,
        currentPrice,
        currentValue: size * currentPrice,
        unrealizedPnl: size * (currentPrice - avgPrice),
        redeemable: resolutionStatus === 'won',
        resolved,
        resolutionStatus
      }
    })
    .filter((entry): entry is MonitorPosition => Boolean(entry))
    .sort((a, b) => b.currentValue - a.currentValue)
}

function normalizeTrades(raw: any[]): MonitorTrade[] {
  return raw
    .map((row) => {
      const side: 'BUY' | 'SELL' = String(row?.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY'
      const price = asNumber(row?.price)
      const size = asNumber(row?.size)
      const amount = size * price

      return {
        id: String(row?.id || row?.transaction_hash || `${row?.match_time || row?.timestamp || ''}-${price}-${size}`),
        tokenId: String(row?.asset || row?.asset_id || row?.token_id || ''),
        side,
        price,
        size,
        amount,
        outcome: String(row?.outcome || row?.outcome_name || ''),
        marketTitle: String(row?.title || row?.question || row?.market || ''),
        timestamp: parseTimestamp(row?.match_time || row?.timestamp || row?.created_at || row?.last_update)
      }
    })
    .sort((a, b) => Date.parse(b.timestamp || '') - Date.parse(a.timestamp || ''))
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate')

  const address = typeof req.query.address === 'string' ? req.query.address.trim() : ''
  if (!isAddress(address)) {
    return res.status(400).json({ error: 'Valid wallet address is required' })
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100)
  const cacheKey = `${address}::${limit}`
  const now = Date.now()
  const cached = SERVER_CACHE.get(cacheKey)
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return res.status(200).json({
      positions: cached.positions,
      trades: cached.trades,
      totalValue: cached.totalValue,
      fetchedAt: new Date(cached.ts).toISOString(),
      status: 'ok'
    })
  }

  try {
    const positionUrls = [
      `${DATA_API}/positions?user=${encodeURIComponent(address)}&sizeThreshold=0.1`,
      `${DATA_API}/positions?address=${encodeURIComponent(address)}&sizeThreshold=0.1`
    ]
    const tradeUrls = [
      `${DATA_API}/trades?user=${encodeURIComponent(address)}&limit=${limit}`,
      `${DATA_API}/trades?address=${encodeURIComponent(address)}&limit=${limit}`
    ]

    const [positionResponses, tradeResponses] = await Promise.all([
      Promise.all(positionUrls.map((url) => fetchJson(url))),
      Promise.all(tradeUrls.map((url) => fetchJson(url)))
    ])

    const rawPositionsCandidates = positionResponses.map((response) => extractRows(response.json, 'positions'))
    const rawTradesCandidates = tradeResponses.map((response) => extractRows(response.json, 'trades'))

    const rawPositions = rawPositionsCandidates.sort((a, b) => b.length - a.length)[0] || []
    const rawTrades = rawTradesCandidates.sort((a, b) => b.length - a.length)[0] || []

    const positions = normalizePositions(rawPositions)
    const trades = normalizeTrades(rawTrades).slice(0, limit)
    const totalValue = positions.reduce((sum, row) => sum + row.currentValue, 0)

    SERVER_CACHE.set(cacheKey, {
      ts: now,
      positions,
      trades,
      totalValue
    })

    return res.status(200).json({
      positions,
      trades,
      totalValue,
      fetchedAt: new Date(now).toISOString(),
      status: positionResponses.some((response) => response.ok) || tradeResponses.some((response) => response.ok)
        ? 'ok'
        : 'unavailable'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return res.status(200).json({
      positions: cached?.positions || [],
      trades: cached?.trades || [],
      totalValue: cached?.totalValue || 0,
      fetchedAt: new Date(now).toISOString(),
      status: 'unavailable',
      error: `wallet-monitor fallback: ${message}`
    })
  }
}
