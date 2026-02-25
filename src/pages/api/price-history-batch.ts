import type { NextApiRequest, NextApiResponse } from 'next'

const CLOB_API = 'https://clob.polymarket.com'
const REQUEST_TIMEOUT_MS = 12000

type RangeKey = '1H' | '1D' | '1W' | '1M' | 'MAX'

const RANGE_CONFIG: Record<RangeKey, { durationSeconds: number; fidelity: number; useMax?: boolean }> = {
  '1H': { durationSeconds: 60 * 60, fidelity: 1 },
  '1D': { durationSeconds: 24 * 60 * 60, fidelity: 5 },
  '1W': { durationSeconds: 7 * 24 * 60 * 60, fidelity: 60 },
  '1M': { durationSeconds: 30 * 24 * 60 * 60, fidelity: 360 },
  'MAX': { durationSeconds: 0, fidelity: 1440, useMax: true }
}

type PriceHistoryPoint = { t: number; p: number }

const SERVER_CACHE = new Map<string, { data: PriceHistoryPoint[]; ts: number }>()
const CACHE_TTL_MS = 60 * 1000
const IN_FLIGHT = new Set<string>()

function parseTokenIds(input: string | string[] | undefined): string[] {
  if (!input) return []
  if (Array.isArray(input)) return input.flatMap((value) => value.split(',').map((v) => v.trim()))
  return input.split(',').map((v) => v.trim())
}

async function fetchHistoryOnce(tokenId: string, range: RangeKey): Promise<PriceHistoryPoint[]> {
  const config = RANGE_CONFIG[range] || RANGE_CONFIG['1W']
  const params = new URLSearchParams()
  params.append('market', tokenId)

  if (config.useMax) {
    params.append('interval', 'max')
    params.append('fidelity', String(config.fidelity))
  } else {
    const endTs = Math.floor(Date.now() / 1000)
    const startTs = endTs - config.durationSeconds
    params.append('startTs', String(startTs))
    params.append('endTs', String(endTs))
    params.append('fidelity', String(config.fidelity))
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${CLOB_API}/prices-history?${params.toString()}`, { signal: controller.signal })
    if (!response.ok) {
      return []
    }

    const data = await response.json()
    return (data.history || []) as PriceHistoryPoint[]
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchHistory(tokenId: string, range: RangeKey): Promise<PriceHistoryPoint[]> {
  const cacheKey = `${range}:${tokenId}`
  const now = Date.now()
  const cached = SERVER_CACHE.get(cacheKey)
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.data
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const history = await fetchHistoryOnce(tokenId, range)
      if (history.length > 0 || attempt === 1) {
        SERVER_CACHE.set(cacheKey, { data: history, ts: now })
        return history
      }
      await new Promise((r) => setTimeout(r, 500))
    } catch (error) {
      if (attempt === 1) {
        console.error('price-history upstream error', error)
      }
    }
  }
  return []
}

async function refreshInBackground(tokenId: string, range: RangeKey) {
  const key = `${range}:${tokenId}`
  if (IN_FLIGHT.has(key)) return
  IN_FLIGHT.add(key)
  try {
    await fetchHistory(tokenId, range)
  } catch {
    // ignore
  } finally {
    IN_FLIGHT.delete(key)
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
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('Surrogate-Control', 'no-store')
  res.removeHeader('ETag')

  const tokenIds = parseTokenIds(req.query.tokenIds)
  const range = (String(req.query.range || '1W').toUpperCase() as RangeKey) || '1W'

  if (!tokenIds.length) {
    return res.status(400).json({ error: 'tokenIds is required' })
  }

  try {
    const historyByToken: Record<string, PriceHistoryPoint[]> = {}
    const pending: string[] = []
    const now = Date.now()
    const fetchNow: string[] = []

    tokenIds.forEach((tokenId) => {
      const cacheKey = `${range}:${tokenId}`
      const cached = SERVER_CACHE.get(cacheKey)
      if (cached) {
        historyByToken[tokenId] = cached.data
        if (now - cached.ts >= CACHE_TTL_MS) {
          pending.push(tokenId)
          refreshInBackground(tokenId, range)
        }
      } else {
        fetchNow.push(tokenId)
      }
    })

    if (fetchNow.length) {
      const results = await mapWithLimit(fetchNow, 2, async (tokenId) => {
        const history = await fetchHistory(tokenId, range)
        return { tokenId, history }
      })

      results.forEach(({ tokenId, history }) => {
        historyByToken[tokenId] = history
        if (!history.length) {
          pending.push(tokenId)
        }
      })
    }

    return res.status(200).json({ historyByToken, pending })
  } catch (error) {
    console.error('price-history-batch error', error)
    return res.status(500).json({ error: 'Failed to fetch price history' })
  }
}
