import type { WeatherEvent, WeatherHubResponse } from '@/types'
import type { ClarificationOption, DataGatherer, GatherSource, MarketContext } from '@/lib/data-gatherers'

interface WeatherGatherFilters {
  baseUrl?: string
  forcedEventId?: string
  dataTools?: boolean
  session?: {
    lastSelectedEventId?: string | null
  }
}

interface ScopeResolution {
  selectedEvent: WeatherEvent | null
  strategy: 'forced' | 'auto' | 'session' | 'none'
  clarification?: {
    question: string
    options: ClarificationOption[]
  }
}

interface ResolvedOutcomeItem {
  sourceId: string
  eventId: string
  eventTitle: string
  eventSlug?: string
  resolvedAt: string
  question: string
  winner: string
  yesPrice: number | null
  noPrice: number | null
}

interface ResolvedOutcomeSnapshot {
  windowDays: number
  itemCount: number
  items: ResolvedOutcomeItem[]
}

interface WeatherPayload {
  selectedEventId: string | null
  events: WeatherEvent[]
  resolvedOutcomes?: ResolvedOutcomeSnapshot
}

function resolveBaseUrl(filters?: WeatherGatherFilters) {
  if (filters?.baseUrl) return filters.baseUrl
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

function formatPrice(value: number | null) {
  if (value === null || value === undefined) return 'n/a'
  return `${(value * 100).toFixed(1)}c`
}

function formatTemp(value: number | null, unit: string) {
  if (value === null || value === undefined) return 'n/a'
  return `${value}°${unit}`
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

function parseIsoDate(value: unknown) {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : value
    const parsed = new Date(ms)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

function resolvedAtFor(event: any, market: any) {
  const candidates = [
    market?.resolutionTime,
    market?.resolveTime,
    market?.closedTime,
    market?.endDate,
    event?.resolutionTime,
    event?.resolveTime,
    event?.closedTime,
    event?.endDate,
    event?.updatedAt,
    event?.createdAt
  ]

  for (const candidate of candidates) {
    const parsed = parseIsoDate(candidate)
    if (parsed) return parsed
  }

  return null
}

function parseOutcomePrices(market: any) {
  const names = parseMaybeArray(market?.outcomes)
  const prices = parseMaybeArray(market?.outcomePrices).map((entry) => {
    const value = Number.parseFloat(entry)
    return Number.isFinite(value) ? value : null
  })

  const yesIndex = names.findIndex((name) => name.toLowerCase() === 'yes')
  const noIndex = names.findIndex((name) => name.toLowerCase() === 'no')

  return {
    names,
    prices,
    yesPrice: yesIndex >= 0 ? prices[yesIndex] ?? null : null,
    noPrice: noIndex >= 0 ? prices[noIndex] ?? null : null
  }
}

function pickWinner(market: any) {
  const directWinner = market?.winner || market?.resolvedOutcome || market?.outcomeWinner
  if (directWinner) return String(directWinner)

  const { names, prices } = parseOutcomePrices(market)
  if (!names.length || !prices.length) return 'unknown'

  let winnerIndex = -1
  let winnerPrice = -1
  for (let index = 0; index < prices.length; index += 1) {
    const price = prices[index] ?? -1
    if (price > winnerPrice) {
      winnerPrice = price
      winnerIndex = index
    }
  }

  if (winnerIndex < 0 || winnerPrice < 0.5) return 'unknown'
  return names[winnerIndex] || 'unknown'
}

function looksLikeResolvedQuery(question: string) {
  return /(resolved|winner|winning|won|settled|settlement|past\s+week|last\s+week|previous\s+week|last\s+\d+\s+days?)/i.test(question)
}

function extractWindowDays(question: string) {
  const week = question.match(/(\d+)\s+weeks?/i)
  if (week) {
    const weeks = Number.parseInt(week[1], 10)
    if (Number.isFinite(weeks) && weeks > 0) return Math.min(weeks * 7, 30)
  }

  const days = question.match(/(\d+)\s+days?/i)
  if (days) {
    const value = Number.parseInt(days[1], 10)
    if (Number.isFinite(value) && value > 0) return Math.min(value, 30)
  }

  return 7
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function includesWholePhrase(haystack: string, needle: string) {
  if (!needle) return false
  return ` ${haystack} `.includes(` ${needle} `)
}

function toYmd(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function relativeDateMap(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = 24 * 60 * 60 * 1000
  return {
    today: toYmd(base),
    tomorrow: toYmd(new Date(base.getTime() + day)),
    yesterday: toYmd(new Date(base.getTime() - day)),
    'day after tomorrow': toYmd(new Date(base.getTime() + (2 * day)))
  }
}

function extractDateConstraints(questionNorm: string, relDates: Record<string, string>) {
  const constraints = new Set<string>()

  if (/\bday after tomorrow\b/.test(questionNorm)) {
    constraints.add(relDates['day after tomorrow'])
  }
  if (/\btomorrow\b/.test(questionNorm) && !/\bday after tomorrow\b/.test(questionNorm)) {
    constraints.add(relDates.tomorrow)
  }
  if (/\btoday\b/.test(questionNorm)) {
    constraints.add(relDates.today)
  }
  if (/\byesterday\b/.test(questionNorm)) {
    constraints.add(relDates.yesterday)
  }

  const isoMatches = questionNorm.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || []
  for (const match of isoMatches) {
    constraints.add(match)
  }

  return constraints
}

function looksBroad(question: string) {
  return /(which city|across|overall|compare|top\s+\d|all markets|ranking|most likely|least likely|highest|lowest)/i.test(question)
}

function looksContextual(question: string) {
  return /(this|that|current|selected|same)\s+(market|event|city|one)/i.test(question)
}

function scoreEventMatch(event: WeatherEvent, questionNorm: string, relDates: Record<string, string>) {
  let score = 0

  const cityNorm = normalizeText(event.city)
  if (includesWholePhrase(questionNorm, cityNorm)) {
    score += 10
  } else {
    for (const token of cityNorm.split(' ').filter((token) => token.length >= 3)) {
      if (includesWholePhrase(questionNorm, token)) score += 3
    }
  }

  if (includesWholePhrase(questionNorm, event.targetDate)) {
    score += 8
  }

  const titleNorm = normalizeText(event.title)
  for (const token of titleNorm.split(' ').filter((token) => token.length >= 5).slice(0, 6)) {
    if (includesWholePhrase(questionNorm, token)) score += 1
  }

  const slugTokens = event.slug.split('-').map((token) => token.trim().toLowerCase()).filter((token) => token.length >= 4)
  let slugHits = 0
  for (const token of slugTokens) {
    if (includesWholePhrase(questionNorm, token)) slugHits += 1
  }
  score += Math.min(slugHits, 3)

  for (const [label, ymd] of Object.entries(relDates)) {
    if (event.targetDate !== ymd) continue
    if (includesWholePhrase(questionNorm, label)) {
      score += 4
      break
    }
  }

  return score
}

function resolveScope(question: string, events: WeatherEvent[], filters: WeatherGatherFilters): ScopeResolution {
  if (!events.length) {
    return {
      selectedEvent: null,
      strategy: 'none'
    }
  }

  if (filters.forcedEventId) {
    const forced = events.find((event) => event.eventId === filters.forcedEventId) || null
    if (forced) {
      return {
        selectedEvent: forced,
        strategy: 'forced'
      }
    }
  }

  const questionNorm = normalizeText(question)
  const parseYmd = (value: string) => {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  const today = new Date()
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dayDistance = (ymd: string) => {
    const parsed = parseYmd(ymd)
    const days = (parsed.getTime() - todayMidnight.getTime()) / (24 * 60 * 60 * 1000)
    return Math.abs(days)
  }
  const relDates = relativeDateMap()
  const scored = events
    .map((event) => ({ event, score: scoreEventMatch(event, questionNorm, relDates) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score === left.score) {
        const leftDistance = dayDistance(left.event.targetDate)
        const rightDistance = dayDistance(right.event.targetDate)
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance
        }
        if (left.event.targetDate === right.event.targetDate) {
          return left.event.city.localeCompare(right.event.city)
        }
        return left.event.targetDate.localeCompare(right.event.targetDate)
      }
      return right.score - left.score
    })

  const broad = looksBroad(questionNorm)
  const dateConstraints = extractDateConstraints(questionNorm, relDates)
  const scopedByDate = dateConstraints.size
    ? scored.filter((entry) => dateConstraints.has(entry.event.targetDate))
    : scored
  const cityMatches = scopedByDate.filter((entry) => includesWholePhrase(questionNorm, normalizeText(entry.event.city)))

  if (!scored.length) {
    const lastSelectedEventId = filters.session?.lastSelectedEventId || null
    if (lastSelectedEventId && looksContextual(questionNorm)) {
      const fromSession = events.find((event) => event.eventId === lastSelectedEventId) || null
      if (fromSession) {
        return {
          selectedEvent: fromSession,
          strategy: 'session'
        }
      }
    }

    return {
      selectedEvent: null,
      strategy: 'none'
    }
  }

  if (cityMatches.length === 1) {
    return {
      selectedEvent: cityMatches[0].event,
      strategy: 'auto'
    }
  }

  if (cityMatches.length > 1) {
    return {
      selectedEvent: cityMatches[0].event,
      strategy: 'auto'
    }
  }

  if (broad && scopedByDate.length > 1) {
    return {
      selectedEvent: null,
      strategy: 'none'
    }
  }

  const top = scopedByDate[0]
  return {
    selectedEvent: top.event,
    strategy: 'auto'
  }
}

async function fetchResolvedWeatherOutcomes(windowDays: number): Promise<ResolvedOutcomeSnapshot> {
  const queries = ['highest temperature', 'lowest temperature', 'weather']
  const eventsById = new Map<string, any>()

  await Promise.all(queries.map(async (query) => {
    const encoded = encodeURIComponent(query)
    const response = await fetch(`https://gamma-api.polymarket.com/public-search?q=${encoded}&limit_per_type=120`)
    if (!response.ok) return

    const json = await response.json() as { events?: any[] }
    for (const event of json.events || []) {
      const key = String(event?.id || event?.slug || '')
      if (!key) continue
      if (!event?.closed && !(event?.markets || []).some((market: any) => market?.closed)) continue
      if (!eventsById.has(key)) eventsById.set(key, event)
    }
  }))

  const threshold = Date.now() - (windowDays * 24 * 60 * 60 * 1000)
  const items: ResolvedOutcomeItem[] = []

  for (const event of eventsById.values()) {
    for (const market of event?.markets || []) {
      const resolvedAt = resolvedAtFor(event, market)
      if (!resolvedAt) continue
      if (resolvedAt.getTime() < threshold) continue

      const winner = pickWinner(market)
      if (winner === 'unknown') continue

      const { yesPrice, noPrice } = parseOutcomePrices(market)
      const marketId = String(market?.id || market?.conditionId || `${event?.id || 'unknown'}-${items.length + 1}`)

      items.push({
        sourceId: `resolved:${marketId}`,
        eventId: String(event?.id || ''),
        eventTitle: String(event?.title || ''),
        eventSlug: event?.slug ? String(event.slug) : undefined,
        resolvedAt: resolvedAt.toISOString(),
        question: String(market?.question || ''),
        winner,
        yesPrice,
        noPrice
      })
    }
  }

  items.sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt))
  const sliced = items.slice(0, 30)

  return {
    windowDays,
    itemCount: sliced.length,
    items: sliced
  }
}

function buildSummary(eventCount: number, selectedEvent: WeatherEvent | null, resolvedCount = 0) {
  if (selectedEvent) {
    return `Weather market snapshot for ${selectedEvent.city} on ${selectedEvent.targetDate} with ${eventCount} active events and ${resolvedCount} recent resolved outcomes loaded.`
  }
  return `Weather market snapshot with ${eventCount} active events and ${resolvedCount} recent resolved outcomes loaded.`
}

function buildSources(
  events: WeatherEvent[],
  selectedEvent: WeatherEvent | null,
  resolvedOutcomes?: ResolvedOutcomeSnapshot
): GatherSource[] {
  const eventSources = events.slice(0, 8).map((event) => ({
    id: event.eventId,
    label: `${event.city} · ${event.targetDate}`,
    detail: event.slug ? `/event/${event.slug}` : undefined,
    url: event.slug ? `https://polymarket.com/event/${event.slug}` : undefined
  }))

  const selectedSource = selectedEvent
    ? {
      id: selectedEvent.eventId,
      label: `${selectedEvent.city} · ${selectedEvent.targetDate}`,
      detail: selectedEvent.slug ? `/event/${selectedEvent.slug}` : undefined,
      url: selectedEvent.slug ? `https://polymarket.com/event/${selectedEvent.slug}` : undefined
    }
    : null

  const resolvedSources = (resolvedOutcomes?.items || []).slice(0, 4).map((item) => ({
    id: item.sourceId,
    label: `Resolved · ${item.winner} · ${item.question}`,
    detail: item.eventSlug ? `/event/${item.eventSlug}` : undefined,
    url: item.eventSlug ? `https://polymarket.com/event/${item.eventSlug}` : undefined
  }))

  const merged = [
    ...(selectedSource ? [selectedSource] : []),
    ...eventSources,
    ...resolvedSources
  ]

  const deduped: GatherSource[] = []
  const seen = new Set<string>()

  for (const source of merged) {
    if (seen.has(source.id)) continue
    seen.add(source.id)
    deduped.push(source)
    if (deduped.length >= 12) break
  }

  return deduped
}

function buildClarificationSources(options: ClarificationOption[], events: WeatherEvent[]) {
  const collected: GatherSource[] = []

  for (const option of options) {
    const event = events.find((item) => item.eventId === option.id)
    if (!event) continue
    collected.push({
      id: event.eventId,
      label: `${event.city} · ${event.targetDate}`,
      detail: event.slug ? `/event/${event.slug}` : undefined,
      url: event.slug ? `https://polymarket.com/event/${event.slug}` : undefined
    })
  }

  return collected
}

function formatEventBlock(event: WeatherEvent) {
  const outcomeLines = event.outcomes.slice(0, 12).map((outcome) => (
    `- ${outcome.question} | YES ${formatPrice(outcome.yesPrice)} | NO ${formatPrice(outcome.noPrice)} | vol ${Math.round(outcome.volume)}`
  ))

  const models = event.weather.modelForecasts?.length
    ? event.weather.modelForecasts
      .map((entry) => `${entry.model}:${entry.value === null ? 'n/a' : `${entry.value}°${event.unit}`}`)
      .join(', ')
    : 'n/a'

  return [
    `SourceId: ${event.eventId}`,
    `Event: ${event.city} | Date: ${event.targetDate} | Unit: ${event.unit}`,
    `Current: ${formatTemp(event.weather.currentTemp, event.unit)} | ForecastHigh: ${formatTemp(event.weather.forecastHigh, event.unit)} | Condition: ${event.weather.condition || 'n/a'}`,
    `ObservedAt: ${event.weather.observationTime || 'n/a'} | Models: ${models}`,
    `HoursToResolution: ${event.hoursToResolution}`,
    'Outcomes:',
    ...outcomeLines,
    ''
  ].join('\n')
}

function formatResolvedBlock(snapshot: ResolvedOutcomeSnapshot | undefined) {
  if (!snapshot || !snapshot.items.length) {
    return 'No recent resolved weather outcomes were collected for the selected window.'
  }

  return snapshot.items
    .slice(0, 20)
    .map((item) => (
      `- SourceId: ${item.sourceId} | ${item.resolvedAt} | Winner: ${item.winner} | YES ${formatPrice(item.yesPrice)} | NO ${formatPrice(item.noPrice)} | ${item.question}`
    ))
    .join('\n')
}

const weatherDataGatherer: DataGatherer = {
  category: 'weather',

  async gather(question: string, filters?: unknown): Promise<MarketContext> {
    const typedFilters = (filters || {}) as WeatherGatherFilters
    const baseUrl = resolveBaseUrl(typedFilters).replace(/\/$/, '')

    const response = await fetch(`${baseUrl}/api/weather-hub?fast=0`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })

    if (!response.ok) {
      throw new Error(`weather-hub failed with ${response.status}`)
    }

    const json = await response.json() as WeatherHubResponse
    const events = Array.isArray(json.events) ? json.events : []
    const scope = resolveScope(question, events, typedFilters)

    if (scope.clarification) {
      const clarificationSources = buildClarificationSources(scope.clarification.options, events)
      return {
        category: 'weather',
        question,
        gatheredAt: new Date().toISOString(),
        summary: `Multiple weather markets matched this question (${scope.clarification.options.length} candidates).`,
        sources: clarificationSources,
        selectedSourceIds: clarificationSources.map((source) => source.id),
        clarification: scope.clarification,
        scope: {
          selectedEventId: null,
          strategy: scope.strategy
        },
        payload: {
          selectedEventId: null,
          events,
          resolvedOutcomes: undefined
        } as WeatherPayload
      }
    }

    const selectedEvent = scope.selectedEvent
    const includeResolvedTools = typedFilters.dataTools !== false && looksLikeResolvedQuery(question)
    const resolvedOutcomes = includeResolvedTools
      ? await fetchResolvedWeatherOutcomes(extractWindowDays(question)).catch(() => undefined)
      : undefined

    const payload: WeatherPayload = {
      selectedEventId: selectedEvent?.eventId || null,
      events,
      resolvedOutcomes
    }

    const sources = buildSources(events, selectedEvent, resolvedOutcomes)
    const selectedSourceIds = selectedEvent ? [selectedEvent.eventId] : []

    return {
      category: 'weather',
      question,
      gatheredAt: new Date().toISOString(),
      summary: buildSummary(events.length, selectedEvent, resolvedOutcomes?.itemCount || 0),
      sources,
      selectedSourceIds,
      scope: {
        selectedEventId: selectedEvent?.eventId || null,
        strategy: scope.strategy
      },
      payload
    }
  },

  formatForPrompt(context: MarketContext): string {
    const payload = context.payload as WeatherPayload
    const events = payload?.events || []
    const selectedEventId = payload?.selectedEventId
    const resolvedOutcomes = payload?.resolvedOutcomes

    const selected = selectedEventId
      ? events.find((event) => event.eventId === selectedEventId) || null
      : null

    const orderedEvents = selected
      ? [selected, ...events.filter((event) => event.eventId !== selected.eventId)].slice(0, 14)
      : events.slice(0, 14)

    const marketBlocks = orderedEvents.map(formatEventBlock).join('\n')

    return [
      'Category: weather',
      `Summary: ${context.summary}`,
      `Data timestamp: ${context.gatheredAt}`,
      `Scope strategy: ${context.scope?.strategy || 'none'}`,
      `Selected source id: ${selectedEventId || 'none'}`,
      '',
      'Weather market data:',
      marketBlocks || 'No weather events found.',
      '',
      `Recent resolved weather outcomes (${resolvedOutcomes?.windowDays || 7}-day window):`,
      formatResolvedBlock(resolvedOutcomes)
    ].join('\n')
  }
}

export default weatherDataGatherer
