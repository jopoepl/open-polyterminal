import weatherDataGatherer from '@/lib/data-gatherers/weather'

export interface GatherSource {
  id: string
  label: string
  detail?: string
  url?: string
}

export interface ClarificationOption {
  id: string
  label: string
  detail?: string
}

export interface ClarificationPrompt {
  question: string
  options: ClarificationOption[]
}

export interface GatherScope {
  selectedEventId: string | null
  strategy: 'forced' | 'auto' | 'session' | 'none'
}

export interface MarketContext {
  category: string
  question: string
  gatheredAt: string
  summary: string
  sources: GatherSource[]
  selectedSourceIds?: string[]
  clarification?: ClarificationPrompt
  scope?: GatherScope
  payload: unknown
}

export interface DataGatherer {
  category: string
  gather(question: string, filters?: unknown): Promise<MarketContext>
  formatForPrompt(context: MarketContext): string
}

const REGISTRY = new Map<string, DataGatherer>()

function register(gatherer: DataGatherer) {
  REGISTRY.set(gatherer.category, gatherer)
}

register(weatherDataGatherer)

export function getDataGatherer(category = 'weather'): DataGatherer {
  return REGISTRY.get(category) || weatherDataGatherer
}

export function listDataGatherers() {
  return Array.from(REGISTRY.keys())
}
