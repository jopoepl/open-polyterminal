import type { NextApiRequest, NextApiResponse } from 'next'
import type { MarketCategoryId, MarketEvent, MarketOutcome } from '@/types'

const GAMMA_API = 'https://gamma-api.polymarket.com'
const CACHE_TTL_MS = 30 * 1000
const REQUEST_TIMEOUT_MS = 7000
const RESOLUTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000

type PrimaryCategory = Exclude<MarketCategoryId, 'all'>

const CATEGORY_TAG_IDS: Record<PrimaryCategory, string[]> = {
  weather: ['84'],
  sports: ['1'],
  politics: ['2'],
  crypto: ['21'],
  business: ['107'],
  culture: ['596']
}

const CATEGORY_LABELS: Record<PrimaryCategory, string> = {
  weather: 'Weather',
  sports: 'Sports',
  politics: 'Politics',
  crypto: 'Crypto',
  business: 'Business',
  culture: 'Culture'
}

const ALL_CATEGORY_PRIORITY: PrimaryCategory[] = [
  'weather',
  'sports',
  'politics',
  'crypto',
  'business',
  'culture'
]

const EVENT_LIMIT_BY_CATEGORY: Record<MarketCategoryId, number> = {
  all: 140,
  weather: 120,
  sports: 120,
  politics: 120,
  crypto: 120,
  business: 120,
  culture: 120
}

interface CacheEntry {
  events: MarketEvent[]
  ts: number
}

const SERVER_CACHE = new Map<MarketCategoryId, CacheEntry>()

function normalizeCategory(value: unknown): MarketCategoryId {
  if (typeof value !== 'string') return 'all'
  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'weather'
    || normalized === 'sports'
    || normalized === 'politics'
    || normalized === 'crypto'
    || normalized === 'business'
    || normalized === 'culture'
    || normalized === 'all'
  ) {
    return normalized
  }
  return 'all'
}

function toNumber(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : 0
}

function parseMaybeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

function parseResolutionTime(value: unknown): Date | null {
  if (!value) return null

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return new Date(value)
    if (value > 1e9) return new Date(value * 1000)
    return null
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  return null
}

function resolveEventTime(event: any, market: any) {
  const candidates = [
    event?.resolutionTime,
    event?.resolveTime,
    event?.endDate,
    event?.closeTime,
    event?.closedTime,
    event?.resolutionDate,
    market?.resolutionTime,
    market?.resolveTime,
    market?.endDate,
    market?.closeTime,
    market?.closedTime
  ]

  for (const candidate of candidates) {
    const parsed = parseResolutionTime(candidate)
    if (parsed) return parsed
  }

  return null
}

function parseTarget(question: string) {
  const rangeMatch = question.match(/(?:between\s+)?(-?\d+)-(-?\d+)°([CF])/i)
  if (rangeMatch) {
    return {
      type: 'range' as const,
      value: parseInt(rangeMatch[1], 10),
      value2: parseInt(rangeMatch[2], 10),
      unit: rangeMatch[3].toUpperCase() as 'C' | 'F'
    }
  }

  const exactMatch = question.match(/(?:be\s+)?(-?\d+)°([CF])\s+on/i)
  if (exactMatch) {
    return {
      type: 'exact' as const,
      value: parseInt(exactMatch[1], 10),
      unit: exactMatch[2].toUpperCase() as 'C' | 'F'
    }
  }

  const aboveMatch = question.match(/(-?\d+)°([CF])\s+or\s+higher/i)
  if (aboveMatch) {
    return {
      type: 'above' as const,
      value: parseInt(aboveMatch[1], 10),
      unit: aboveMatch[2].toUpperCase() as 'C' | 'F'
    }
  }

  const belowMatch = question.match(/(-?\d+)°([CF])\s+or\s+below/i)
  if (belowMatch) {
    return {
      type: 'below' as const,
      value: parseInt(belowMatch[1], 10),
      unit: belowMatch[2].toUpperCase() as 'C' | 'F'
    }
  }

  return null
}

function parseOutcomes(markets: any[]): MarketOutcome[] {
  const parsed: Array<MarketOutcome | null> = markets.map((market): MarketOutcome | null => {
      const outcomeNames = parseMaybeArray(market?.outcomes)
      const tokenIds = parseMaybeArray(market?.clobTokenIds)
      const outcomePrices = parseMaybeArray(market?.outcomePrices).map((price) => Number(price))

      const yesIndex = outcomeNames.findIndex((name) => name.toLowerCase() === 'yes')
      const noIndex = outcomeNames.findIndex((name) => name.toLowerCase() === 'no')

      if (yesIndex < 0 || noIndex < 0) return null

      const yesTokenId = tokenIds[yesIndex] || ''
      const noTokenId = tokenIds[noIndex] || ''
      if (!yesTokenId || !noTokenId) return null

      const yesPrice = Number.isFinite(outcomePrices[yesIndex]) ? outcomePrices[yesIndex] : null
      const noPrice = Number.isFinite(outcomePrices[noIndex]) ? outcomePrices[noIndex] : null
      const oneDayPriceChangeRaw = Number(market?.oneDayPriceChange)
      const oneDayPriceChange = Number.isFinite(oneDayPriceChangeRaw) ? oneDayPriceChangeRaw : null

      const question = String(market?.question || '')

      return {
        marketId: String(market?.id || ''),
        conditionId: String(market?.conditionId || market?.condition_id || ''),
        question,
        yesTokenId,
        noTokenId,
        yesPrice,
        noPrice,
        oneDayPriceChange,
        volume: toNumber(market?.volumeNum ?? market?.volume),
        liquidity: toNumber(market?.liquidityNum ?? market?.liquidity),
        target: parseTarget(question)
      }
    })

  return parsed.filter((entry): entry is MarketOutcome => entry !== null)
}

function parseTagIds(event: any) {
  const tags = Array.isArray(event?.tags) ? event.tags : []
  return new Set(tags.map((tag: any) => String(tag?.id || '')).filter(Boolean))
}

function parseTagLabels(event: any) {
  const tags: Array<Record<string, unknown>> = Array.isArray(event?.tags) ? event.tags : []
  const labels = tags.map((tag: any) => String(tag?.label || tag?.slug || '').trim()).filter(Boolean)
  return Array.from(new Set(labels)).slice(0, 10)
}

function detectCategory(event: any): PrimaryCategory {
  const tagIds = parseTagIds(event)
  for (const category of ALL_CATEGORY_PRIORITY) {
    if (CATEGORY_TAG_IDS[category].some((id) => tagIds.has(id))) return category
  }
  return 'business'
}

function asIso(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

async function fetchEventsByTag(tagId: string, limit: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const url = `${GAMMA_API}/events?tag_id=${encodeURIComponent(tagId)}&active=true&closed=false&limit=${limit}`
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json) ? json : []
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchEvents(category: MarketCategoryId, perTagLimit: number) {
  if (category === 'all') {
    const rows = await Promise.all(
      ALL_CATEGORY_PRIORITY.map(async (key) => {
        const events = await fetchEventsByTag(CATEGORY_TAG_IDS[key][0], perTagLimit)
        return { key, events }
      })
    )

    const byId = new Map<string, { event: any; category: PrimaryCategory }>()
    for (const row of rows) {
      for (const event of row.events) {
        const id = String(event?.id || event?.slug || '')
        if (!id || byId.has(id)) continue
        byId.set(id, { event, category: row.key })
      }
    }

    return Array.from(byId.values())
  }

  const events = await fetchEventsByTag(CATEGORY_TAG_IDS[category][0], perTagLimit)
  return events.map((event) => ({ event, category }))
}

function buildMarketEvent(rawEvent: any, forcedCategory?: PrimaryCategory): MarketEvent | null {
  const markets = Array.isArray(rawEvent?.markets) ? rawEvent.markets : []
  if (!markets.length) return null

  const outcomes = parseOutcomes(markets)
  if (!outcomes.length) return null

  const category = forcedCategory || detectCategory(rawEvent)
  const categoryLabel = CATEGORY_LABELS[category]
  const resolutionAt = resolveEventTime(rawEvent, markets[0])
  const hoursToResolution = resolutionAt
    ? Math.max(0, Math.round((resolutionAt.getTime() - Date.now()) / (1000 * 60 * 60)))
    : null

  const marketVolume = outcomes.reduce((sum, outcome) => sum + outcome.volume, 0)
  const marketLiquidity = outcomes.reduce((sum, outcome) => sum + outcome.liquidity, 0)
  const eventVolume = toNumber(rawEvent?.volumeNum ?? rawEvent?.volume)
  const eventVolume24h = toNumber(rawEvent?.volume24hr)
  const eventLiquidity = toNumber(rawEvent?.liquidityNum ?? rawEvent?.liquidity)
  const maxAbsMove24h = outcomes.reduce((max, outcome) => {
    const move = Number.isFinite(outcome.oneDayPriceChange) ? Math.abs(outcome.oneDayPriceChange as number) : 0
    return Math.max(max, move)
  }, 0)
  const closestToMid = outcomes.reduce<number | null>((min, outcome) => {
    if (outcome.yesPrice === null || outcome.yesPrice === undefined) return min
    const dist = Math.abs(outcome.yesPrice - 0.5)
    if (min === null || dist < min) return dist
    return min
  }, null)

  return {
    eventId: String(rawEvent?.id || ''),
    title: String(rawEvent?.title || ''),
    slug: String(rawEvent?.slug || ''),
    category,
    categoryLabel,
    description: String(rawEvent?.description || ''),
    startDate: asIso(rawEvent?.startDate || rawEvent?.startDateIso || null),
    createdAt: asIso(rawEvent?.createdAt || rawEvent?.creationDate || null),
    endDate: asIso(rawEvent?.endDate || rawEvent?.endDateIso || null),
    resolveDate: resolutionAt ? resolutionAt.toISOString() : null,
    hoursToResolution,
    volume: eventVolume > 0 ? eventVolume : marketVolume,
    volume24h: eventVolume24h,
    activity1hEstimate: eventVolume24h > 0 ? eventVolume24h / 24 : 0,
    liquidity: eventLiquidity > 0 ? eventLiquidity : marketLiquidity,
    openInterest: toNumber(rawEvent?.openInterest),
    maxAbsMove24h,
    closestToMid,
    marketCount: markets.length,
    tags: parseTagLabels(rawEvent),
    outcomes
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Pragma', 'no-cache')

  const category = normalizeCategory(req.query.category)
  const now = Date.now()
  const cached = SERVER_CACHE.get(category)
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return res.status(200).json({
      category,
      events: cached.events,
      fetchedAt: new Date(cached.ts).toISOString()
    })
  }

  try {
    const perTagLimit = category === 'all' ? 80 : 160
    const raw = await fetchEvents(category, perTagLimit)
    const events = raw
      .map((entry) => buildMarketEvent(entry.event, category === 'all' ? entry.category : undefined))
      .filter((entry): entry is MarketEvent => Boolean(entry))
      .filter((event) => {
        if (!event.resolveDate) return true
        const resolvedTs = Date.parse(event.resolveDate)
        if (!Number.isFinite(resolvedTs)) return true
        return resolvedTs >= Date.now() - RESOLUTION_GRACE_MS
      })
      .sort((a, b) => (
        b.liquidity - a.liquidity
        || b.volume - a.volume
        || (a.resolveDate || '').localeCompare(b.resolveDate || '')
      ))
      .slice(0, EVENT_LIMIT_BY_CATEGORY[category])

    SERVER_CACHE.set(category, { events, ts: now })

    return res.status(200).json({
      category,
      events,
      fetchedAt: new Date(now).toISOString()
    })
  } catch (error) {
    console.error('market-hub error', error)
    return res.status(500).json({ error: 'Failed to build market hub' })
  }
}
