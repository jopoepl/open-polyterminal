export type TimeRange = '1H' | '1D' | '1W' | '1M' | 'MAX'
export type AiProvider = 'claude' | 'codex'
export type MarketCategoryId = 'all' | 'weather' | 'sports' | 'politics' | 'crypto' | 'business' | 'culture'

export interface MarketOutcome {
  marketId: string
  conditionId?: string
  question: string
  yesTokenId: string
  noTokenId: string
  yesPrice: number | null
  noPrice: number | null
  oneDayPriceChange?: number | null
  volume: number
  liquidity: number
  target: {
    type: 'exact' | 'range' | 'above' | 'below'
    value: number
    value2?: number
    unit: 'C' | 'F'
  } | null
}

export interface MarketEvent {
  eventId: string
  title: string
  slug: string
  category: Exclude<MarketCategoryId, 'all'>
  categoryLabel: string
  description: string
  startDate: string | null
  createdAt: string | null
  endDate: string | null
  resolveDate: string | null
  hoursToResolution: number | null
  volume: number
  volume24h: number
  activity1hEstimate: number
  liquidity: number
  openInterest: number
  maxAbsMove24h: number
  closestToMid: number | null
  marketCount: number
  tags: string[]
  outcomes: MarketOutcome[]
}

export interface MarketHubResponse {
  category: MarketCategoryId
  events: MarketEvent[]
  fetchedAt: string
}

export interface WeatherEvent {
  eventId: string
  title: string
  city: string
  targetDate: string
  unit: 'C' | 'F'
  hoursToResolution: number
  localTime: string
  localDate: string
  slug: string
  weather: {
    currentTemp: number | null
    forecastHigh: number | null
    condition: string | null
    metarRaw: string | null
    observationTime: string | null
    forecastSource?: string | null
    forecastStatus?: 'pending' | 'ok' | 'unavailable'
    forecastReason?: string | null
    modelForecasts?: Array<{ model: string; value: number | null }>
  }
  outcomes: WeatherOutcome[]
}

export interface WeatherOutcome {
  marketId: string
  conditionId?: string
  question: string
  yesTokenId: string
  noTokenId: string
  yesPrice: number | null
  noPrice: number | null
  volume: number
  liquidity: number
  target: {
    type: 'exact' | 'range' | 'above' | 'below'
    value: number
    value2?: number
    unit: 'C' | 'F'
  } | null
}

export interface WeatherHubResponse {
  events: WeatherEvent[]
  fetchedAt: string
}

export interface AskSource {
  id: string
  label: string
  detail?: string
  url?: string
}

export interface AskFollowUpOption {
  id: string
  label: string
  detail?: string
}

export interface AskResponse {
  answer: string
  sources: AskSource[]
  timestamp: string
  provider?: AiProvider
  sessionId?: string
  requiresClarification?: boolean
  followUpQuestion?: string
  followUpOptions?: AskFollowUpOption[]
  error?: string
}
