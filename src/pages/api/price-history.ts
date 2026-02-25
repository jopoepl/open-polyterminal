import type { NextApiRequest, NextApiResponse } from 'next'

const CLOB_API = 'https://clob.polymarket.com'
const REQUEST_TIMEOUT_MS = 6000

type RangeKey = '1H' | '1D' | '1W' | '1M' | 'MAX'

const RANGE_CONFIG: Record<RangeKey, { durationSeconds: number; fidelity: number; useMax?: boolean }> = {
  '1H': { durationSeconds: 60 * 60, fidelity: 1 },
  '1D': { durationSeconds: 24 * 60 * 60, fidelity: 5 },
  '1W': { durationSeconds: 7 * 24 * 60 * 60, fidelity: 60 },
  '1M': { durationSeconds: 30 * 24 * 60 * 60, fidelity: 360 },
  'MAX': { durationSeconds: 0, fidelity: 1440, useMax: true }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const tokenId = String(req.query.tokenId || '')
  const range = (String(req.query.range || '1W').toUpperCase() as RangeKey) || '1W'

  if (!tokenId) {
    return res.status(400).json({ error: 'tokenId is required' })
  }

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
      return res.status(200).json({ history: [], warning: 'upstream error' })
    }
    const data = await response.json()
    return res.status(200).json({ history: data.history || [] })
  } catch (error) {
    console.error('price-history error', error)
    return res.status(200).json({ history: [], warning: 'timeout' })
  } finally {
    clearTimeout(timeout)
  }
}
