import type { NextApiRequest, NextApiResponse } from 'next'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveAiProvider, runAiPrompt } from '@/lib/ai'
import type { AiMcpServerOverride, McpMode, McpServerName } from '@/lib/ai'
import { getDataGatherer } from '@/lib/data-gatherers'
import type { ClarificationOption, GatherSource } from '@/lib/data-gatherers'
import type { AiProvider } from '@/types'

interface AskRequestBody {
  question?: string
  category?: string
  provider?: AiProvider
  sessionId?: string
}

interface AskResponseBody {
  answer: string
  sources: GatherSource[]
  timestamp: string
  provider?: AiProvider
  sessionId: string
  requiresClarification?: boolean
  followUpQuestion?: string
  followUpOptions?: ClarificationOption[]
  error?: string
}

interface PendingClarification {
  question: string
  category: string
  options: ClarificationOption[]
}

interface AskSessionState {
  updatedAt: number
  lastCategory: string
  lastSelectedEventId?: string
  pendingClarification?: PendingClarification
}

interface AskStreamStatusEvent {
  type: 'status'
  message: string
}

interface AskStreamCliEvent {
  type: 'cli'
  provider: AiProvider
  stream: 'stdout' | 'stderr'
  text: string
}

interface AskStreamFinalEvent {
  type: 'final'
  data: AskResponseBody
}

interface AskStreamErrorEvent {
  type: 'error'
  error: string
}

type AskStreamEvent = AskStreamStatusEvent | AskStreamCliEvent | AskStreamFinalEvent | AskStreamErrorEvent

type AskMcpName = Extract<McpServerName, 'weather' | 'polymarket' | 'news'>

interface AskMcpSpec {
  name: AskMcpName
  label: string
  envPrefix: 'WEATHER_MCP' | 'POLYMARKET_MCP' | 'NEWS_MCP'
  defaultUrl?: string | null
}

const API_REFERENCE_PATH = path.join(
  process.cwd(),
  'skills',
  'polymarket-api-router',
  'references',
  'polymarket-api-reference.md'
)

const SESSION_STORE = new Map<string, AskSessionState>()
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

let API_REFERENCE_CACHE: { value: string; ts: number } | null = null
const API_REFERENCE_TTL_MS = 5 * 60 * 1000

function isStreamRequest(req: NextApiRequest) {
  const value = req.query.stream
  if (Array.isArray(value)) {
    return value.includes('1') || value.includes('true')
  }

  return value === '1' || value === 'true'
}

function normalizeMcpUrl(raw?: string | null) {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).toString()
  } catch {
    return null
  }
}

async function probeMcpHttp(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    return res.status >= 200 && res.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function getDefaultWeatherMcpUrl() {
  return normalizeMcpUrl(process.env.WEATHER_MCP_DEFAULT_URL || 'http://127.0.0.1:8787/mcp')
}

function mcpEnabled(prefix: AskMcpSpec['envPrefix']) {
  return process.env[`${prefix}_ENABLED`] !== '0'
}

function mcpConfiguredUrl(prefix: AskMcpSpec['envPrefix']) {
  return normalizeMcpUrl(process.env[`${prefix}_URL`])
}

function skipMcpProbe() {
  return process.env.MCP_SKIP_RUNTIME_PROBE === '1'
}

async function resolveMcpRuntime(
  spec: AskMcpSpec,
  emitStatus: (message: string) => void
): Promise<AiMcpServerOverride> {
  if (skipMcpProbe()) {
    const configuredUrl = mcpConfiguredUrl(spec.envPrefix) || (spec.defaultUrl || null)
    if (configuredUrl) {
      emitStatus(`Using configured MCP ${spec.label} HTTP URL (probe skipped).`)
      return { mode: 'http', url: configuredUrl }
    }

    if (!mcpEnabled(spec.envPrefix)) {
      emitStatus(`MCP ${spec.label} disabled by env.`)
      return { mode: 'disabled' as McpMode }
    }

    emitStatus(`MCP ${spec.label} probe skipped; using stdio fallback.`)
    return { mode: 'stdio' as McpMode }
  }

  if (!mcpEnabled(spec.envPrefix)) {
    emitStatus(`MCP ${spec.label} disabled by env.`)
    return { mode: 'disabled' as McpMode }
  }

  const configuredUrl = mcpConfiguredUrl(spec.envPrefix)
  const candidateUrls = [
    configuredUrl,
    configuredUrl ? null : spec.defaultUrl || null
  ].filter(Boolean) as string[]

  let selectedHttpUrl: string | null = null
  for (const candidateUrl of candidateUrls) {
    emitStatus(`Checking MCP ${spec.label} HTTP: ${candidateUrl}`)
    const reachable = await probeMcpHttp(candidateUrl)
    if (reachable) {
      selectedHttpUrl = candidateUrl
      break
    }
  }

  if (selectedHttpUrl) {
    emitStatus(`MCP ${spec.label} mode: http`)
    return {
      mode: 'http' as McpMode,
      url: selectedHttpUrl
    }
  }

  if (configuredUrl) {
    emitStatus(`Configured MCP ${spec.label} HTTP unreachable; falling back to stdio mode.`)
  } else {
    emitStatus(`No reachable MCP ${spec.label} HTTP endpoint detected; using stdio mode.`)
  }

  return { mode: 'stdio' as McpMode }
}

function resolveBaseUrl(req: NextApiRequest) {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL

  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim()
  const forwardedProto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim()
  const proto = forwardedProto || (process.env.NODE_ENV === 'development' ? 'http' : 'https')

  if (!host) return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
  return `${proto}://${host}`
}

async function loadApiReferenceText() {
  const now = Date.now()
  if (API_REFERENCE_CACHE && now - API_REFERENCE_CACHE.ts < API_REFERENCE_TTL_MS) {
    return API_REFERENCE_CACHE.value
  }

  try {
    const value = await readFile(API_REFERENCE_PATH, 'utf8')
    API_REFERENCE_CACHE = { value, ts: now }
    return value
  } catch {
    return ''
  }
}

function splitTopLevelSections(markdown: string) {
  const sections: Array<{ heading: string; body: string }> = []
  const lines = markdown.split('\n')
  let currentHeading = ''
  let buffer: string[] = []

  const flush = () => {
    if (!currentHeading) return
    sections.push({ heading: currentHeading, body: buffer.join('\n').trim() })
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush()
      currentHeading = line.trim()
      buffer = []
      continue
    }
    if (currentHeading) buffer.push(line)
  }

  flush()
  return sections
}

function extractSection(sections: Array<{ heading: string; body: string }>, heading: string) {
  const found = sections.find((section) => section.heading.toLowerCase() === heading.toLowerCase())
  if (!found) return ''
  return `${found.heading}\n${found.body}`.trim()
}

function buildScopedApiRoutingGuide(question: string, referenceMarkdown: string) {
  if (!referenceMarkdown.trim()) return ''

  const sections = splitTopLevelSections(referenceMarkdown)
  const q = question.toLowerCase()
  const selected = new Set<string>([
    '## Base URLs',
    '## Intent -> Endpoint Routing',
    '## Required IDs Cheatsheet'
  ])

  if (/(trade|fill|volume|liquidity|activity)/i.test(q)) {
    selected.add('## Data API')
    selected.add('## CLOB API')
  }

  if (/(position|portfolio|wallet|exposure|holding)/i.test(q)) {
    selected.add('## Data API')
  }

  if (/(price history|history|chart|timeseries|time series|candles?)/i.test(q)) {
    selected.add('## CLOB API')
  }

  if (/(event|market|discover|search|winner|winning|resolved|settle|settlement)/i.test(q)) {
    selected.add('## Gamma API')
    selected.add('## Pattern: Winning Outcomes In Past 7 Days')
  }

  const blocks = Array.from(selected)
    .map((heading) => extractSection(sections, heading))
    .filter(Boolean)

  if (!blocks.length) return ''

  const combined = blocks.join('\n\n').trim()
  const maxChars = 9000
  return combined.length > maxChars ? `${combined.slice(0, maxChars)}\n\n[Truncated]` : combined
}

function buildSourceCatalog(sources: GatherSource[]) {
  if (!sources.length) return 'No source catalog available.'
  return sources
    .slice(0, 30)
    .map((source) => {
      const detail = source.url || source.detail || ''
      return `- ${source.id} | ${source.label}${detail ? ` | ${detail}` : ''}`
    })
    .join('\n')
}

function buildPrompt(
  question: string,
  marketContextBlock: string,
  sourceCatalog: string,
  options: {
    webSearch: boolean
    dataTools: boolean
    apiRoutingGuide: string
    requireExternalEvidence?: boolean
    strictExternalRetry?: boolean
    mcpOnlyWeather?: boolean
  }
) {
  const scopeLines = [
    'Scope and tooling rules:',
    '- Scope automatically using the market context data provided below.',
    '- Data-only policy: provide neutral analysis and comparisons, not betting recommendations.',
    '- If uncertain, say what is missing.',
    '- If additional data is needed, fetch it using available tools/web search and incorporate the findings.',
    '- Do not expose raw internal API endpoints, request templates, or tool-execution instructions in the user-facing answer unless the user explicitly asks for technical implementation details.',
    '- If you used any external source (web or tool-fetched), include absolute URLs in WEB_SOURCES_USED.'
  ]

  if (options.webSearch) {
    scopeLines.push('- Web search is allowed, but only for scoped event facts or settlement-relevant sources.')
  } else {
    scopeLines.push('- Do not use web search; rely only on provided context.')
  }

  if (options.mcpOnlyWeather) {
    scopeLines.push('- MCP-only weather query: use weather MCP tools only for temperature/current/forecast answers.')
    scopeLines.push('- Do not use external web search for this query, even if additional details are desired.')
  }

  if (options.dataTools) {
    scopeLines.push('- Prioritize provided tool-collected blocks (resolved outcomes, weather snapshots) when present.')
    scopeLines.push('- MCP tools are available across servers.')
    scopeLines.push('- Weather MCP: list_weather_stations, resolve_weather_station, get_metar_observation, get_open_meteo_forecast.')
    scopeLines.push('- Polymarket MCP: pm_search, pm_list_events, pm_list_markets, pm_get_event, pm_get_market, pm_get_trades, pm_get_positions, pm_get_orderbook, pm_get_price_history.')
    scopeLines.push('- News MCP: news_search_articles, news_topic_snapshot, news_topic_timeline.')
    scopeLines.push('- For current or near-term weather questions, resolve station first and fetch fresh METAR + forecast before finalizing the answer.')
  }

  if (options.requireExternalEvidence) {
    scopeLines.push('- External web research is required for this answer because local context is incomplete or stale.')
    scopeLines.push('- You must provide at least one real absolute URL in WEB_SOURCES_USED.')
  }

  if (options.strictExternalRetry) {
    scopeLines.push('- Previous attempt omitted usable WEB_SOURCES_USED; include concrete URLs now.')
  }

  return [
    'You are PolyTerminal Analyst. Answer from provided market context plus tool-fetched evidence.',
    'If data is missing, state uncertainty explicitly. Do not invent market prices or event details.',
    'Never provide betting, trading, or investment advice. Do not recommend a "best bet" or what to buy/sell.',
    'If the user asks for a recommendation, decline and provide a neutral comparison using data only.',
    'Use concise structure: Market snapshot, Interpretation, Risks/unknowns.',
    'At the end, add exactly these metadata lines:',
    '- SOURCES_USED: <comma-separated source IDs from Source catalog, or none>',
    '- WEB_SOURCES_USED: <comma-separated absolute URLs used, or none>',
    '- NEEDS_EXTERNAL_DATA: <yes|no>',
    'If web search is disabled and external sources would materially improve accuracy, set NEEDS_EXTERNAL_DATA: yes.',
    'If web search is enabled and you used external sources, include each URL in WEB_SOURCES_USED.',
    ...scopeLines,
    '',
    'Polymarket API routing playbook:',
    options.apiRoutingGuide || 'Unavailable',
    '',
    'Source catalog (IDs you may cite):',
    sourceCatalog,
    '',
    marketContextBlock,
    '',
    `User question: ${question}`
  ].join('\n')
}

function inferExecutionOptions(question: string, category: string) {
  const q = question.toLowerCase()
  const dataTools = true
  const mcpOnlyWeather = isMcpOnlyWeatherQuery(question, category)

  const explicitWebSearch = /(search the web|web search|look up|google|news|report|official source|external source)/i.test(q)
  const webSearch = mcpOnlyWeather ? false : explicitWebSearch

  if (category !== 'weather') {
    return { webSearch, dataTools, mcpOnlyWeather }
  }

  const strictlyMarketQuestion = /(odds|price|yes|no|volume|liquidity|spread|winner|resolved|settled|outcome)/i.test(q)
  if (strictlyMarketQuestion && !explicitWebSearch) {
    return { webSearch: false, dataTools, mcpOnlyWeather }
  }

  return { webSearch, dataTools, mcpOnlyWeather }
}

function questionDemandsFreshness(question: string) {
  return /(current|currently|right now|latest|live|today|as of now)/i.test(question)
}

function isCurrentWeatherIntent(question: string) {
  return /(weather|temperature|temp)/i.test(question) && questionDemandsFreshness(question)
}

function isMcpOnlyWeatherQuery(question: string, category: string) {
  if (category !== 'weather') return false
  const q = question.toLowerCase()
  const temperatureIntent = /\b(temp|temperature)\b/i.test(q)
  const forecastIntent = /\bforecast|next few hours|next\s+\d+\s+hours?\b/i.test(q)
  const currentWeatherIntent = /\bcurrent weather\b/i.test(q) || isCurrentWeatherIntent(question)
  return temperatureIntent || forecastIntent || currentWeatherIntent
}

function pickSelectedWeatherEvent(context: any) {
  const payload = context?.payload
  const events = Array.isArray(payload?.events) ? payload.events : []
  if (!events.length) return null

  const selectedEventId = context?.scope?.selectedEventId || payload?.selectedEventId
  if (!selectedEventId) return null

  return events.find((event: any) => event?.eventId === selectedEventId) || null
}

function weatherSnapshotNeedsFetch(context: any) {
  const selected = pickSelectedWeatherEvent(context)
  if (!selected) return true

  const currentTemp = selected?.weather?.currentTemp
  if (currentTemp === null || currentTemp === undefined) return true

  const conditionRaw = String(selected?.weather?.condition || '').trim().toLowerCase()
  if (!conditionRaw || conditionRaw === 'n/a' || conditionRaw === 'na' || conditionRaw === 'unknown') {
    return true
  }

  const observedAtRaw = selected?.weather?.observationTime
  if (!observedAtRaw) return true

  const observedAtTs = Date.parse(String(observedAtRaw))
  if (Number.isNaN(observedAtTs)) return true

  const maxAgeMs = 2 * 60 * 60 * 1000
  return Date.now() - observedAtTs > maxAgeMs
}

function shouldForceWebSearch(
  question: string,
  category: string,
  context: any,
  initialWebSearch: boolean,
  mcpOnlyWeather: boolean
) {
  if (mcpOnlyWeather) return false
  if (initialWebSearch) return true

  if (category === 'weather' && isCurrentWeatherIntent(question)) {
    return weatherSnapshotNeedsFetch(context)
  }

  return false
}

function answerSignalsMissingData(answer: string) {
  return /(missing|n\/a|not available|unknown|uncertain|insufficient|cannot determine|not provided|stale)/i.test(answer)
}

function lineContainsBettingAdvice(line: string) {
  const patterns = [
    /\b(good|best|solid|strong)\s+bet\b/i,
    /\b(i recommend|my recommendation)\b/i,
    /\byou should\s+(bet|buy|sell|take)\b/i,
    /\b(i would bet|i'd bet)\b/i,
    /\bbet on\b/i,
    /\bgo long\b/i,
    /\bgo short\b/i
  ]

  return patterns.some((pattern) => pattern.test(line))
}

function containsBettingAdvice(text: string) {
  if (!text.trim()) return false
  return text.split('\n').some((line) => lineContainsBettingAdvice(line))
}

function enforceNeutralDataOnlyAnswer(answer: string) {
  if (!containsBettingAdvice(answer)) return answer

  const filteredLines = answer
    .split('\n')
    .filter((line) => !lineContainsBettingAdvice(line))

  const cleaned = filteredLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const neutralPrefix = 'I can’t provide betting recommendations. Here is a neutral data view so you can decide.'

  if (!cleaned) {
    return `${neutralPrefix}\n\nUse prices, liquidity, recent trades, and time-to-resolution to compare outcomes.`
  }

  return `${neutralPrefix}\n\n${cleaned}`
}

function parseYesNo(raw: string) {
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'yes') return true
  if (normalized === 'no') return false
  return false
}

function extractUrlsFromText(text: string) {
  const matches = text.match(/https?:\/\/[^\s<>)\]}]+/g) || []
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const match of matches) {
    const cleaned = match.replace(/[.,;:!?]+$/, '')
    try {
      const url = new URL(cleaned)
      const normalized = url.toString()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      deduped.push(normalized)
    } catch {
      continue
    }
  }

  return deduped
}

function buildWebSource(url: string, index: number): GatherSource {
  let label = url
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    label = `${parsed.hostname}${path}`.slice(0, 110)
  } catch {
    // keep full URL as label
  }

  return {
    id: `web:${index}:${url}`,
    label,
    detail: 'External source',
    url
  }
}

function mergeSources(primary: GatherSource[], extra: GatherSource[]) {
  const merged: GatherSource[] = []
  const seen = new Set<string>()
  const byUrl = new Set<string>()

  for (const source of [...primary, ...extra]) {
    const urlKey = source.url ? source.url.toLowerCase() : ''
    if (seen.has(source.id)) continue
    if (urlKey && byUrl.has(urlKey)) continue
    seen.add(source.id)
    if (urlKey) byUrl.add(urlKey)
    merged.push(source)
  }

  return merged
}

function sanitizeSessionId(value?: string) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(trimmed)) return null
  return trimmed
}

function newSessionId() {
  try {
    return randomUUID().replace(/-/g, '')
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  }
}

function cleanupSessions() {
  const now = Date.now()
  for (const [sessionId, state] of SESSION_STORE) {
    if (now - state.updatedAt > SESSION_TTL_MS) {
      SESSION_STORE.delete(sessionId)
    }
  }
}

function getSession(sessionIdRaw?: string) {
  cleanupSessions()

  const sessionId = sanitizeSessionId(sessionIdRaw) || newSessionId()
  const existing = SESSION_STORE.get(sessionId)

  if (existing) {
    existing.updatedAt = Date.now()
    SESSION_STORE.set(sessionId, existing)
    return { sessionId, state: existing }
  }

  const created: AskSessionState = {
    updatedAt: Date.now(),
    lastCategory: 'weather'
  }
  SESSION_STORE.set(sessionId, created)
  return { sessionId, state: created }
}

function resolveClarificationSelection(input: string, options: ClarificationOption[]) {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return null

  const numberMatch = normalized.match(/(?:^|\s)(\d{1,2})(?:\s|$)/)
  if (numberMatch) {
    const index = Number.parseInt(numberMatch[1], 10) - 1
    if (index >= 0 && index < options.length) {
      return options[index]
    }
  }

  const exactId = options.find((option) => option.id.toLowerCase() === normalized)
  if (exactId) return exactId

  const exactLabel = options.find((option) => option.label.toLowerCase() === normalized)
  if (exactLabel) return exactLabel

  const partialMatches = options.filter((option) => {
    const label = option.label.toLowerCase()
    return normalized.includes(label) || label.includes(normalized)
  })

  if (partialMatches.length === 1) return partialMatches[0]
  return null
}

function parseSourceIds(raw: string) {
  const normalized = raw.trim()
  if (!normalized || /^none$/i.test(normalized)) return []

  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    try {
      const parsed = JSON.parse(normalized)
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean)
      }
    } catch {
      return []
    }
  }

  return normalized
    .split(',')
    .map((entry) => entry.replace(/^['"`\s]+|['"`\s]+$/g, ''))
    .filter(Boolean)
}

function parseAnswerAndCitations(answer: string, sources: GatherSource[]) {
  const lines = answer.split('\n')
  let sourceLineValue = ''
  let webSourceLineValue = ''
  let needsExternalDataValue = ''
  const removableLineIndexes: number[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const sourceMatch = line.match(/^\s*[-*]?\s*SOURCES_USED\s*:\s*(.+)\s*$/i)
    if (sourceMatch) {
      sourceLineValue = sourceMatch[1]
      removableLineIndexes.push(index)
      continue
    }

    const webMatch = line.match(/^\s*[-*]?\s*WEB_SOURCES_USED\s*:\s*(.+)\s*$/i)
    if (webMatch) {
      webSourceLineValue = webMatch[1]
      removableLineIndexes.push(index)
      continue
    }

    const externalNeedMatch = line.match(/^\s*[-*]?\s*NEEDS_EXTERNAL_DATA\s*:\s*(.+)\s*$/i)
    if (externalNeedMatch) {
      needsExternalDataValue = externalNeedMatch[1]
      removableLineIndexes.push(index)
    }
  }

  for (const index of removableLineIndexes.sort((a, b) => b - a)) {
    lines.splice(index, 1)
  }

  const citedIds = parseSourceIds(sourceLineValue)
  const webUrls = parseSourceIds(webSourceLineValue)
  const byId = new Map(sources.map((source) => [source.id, source]))
  const citedSources: GatherSource[] = []
  const seen = new Set<string>()

  for (const id of citedIds) {
    const source = byId.get(id)
    if (!source || seen.has(source.id)) continue
    seen.add(source.id)
    citedSources.push(source)
  }

  return {
    cleanAnswer: lines.join('\n').trim(),
    citedSources,
    webUrls,
    needsExternalData: parseYesNo(needsExternalDataValue)
  }
}

function pickSourcesByIds(sources: GatherSource[], ids: string[] | undefined) {
  if (!ids?.length) return []
  const byId = new Map(sources.map((source) => [source.id, source]))
  const picked: GatherSource[] = []
  const seen = new Set<string>()

  for (const id of ids) {
    const source = byId.get(id)
    if (!source || seen.has(source.id)) continue
    seen.add(source.id)
    picked.push(source)
  }

  return picked
}

function clarificationResponse(
  sessionId: string,
  question: string,
  options: ClarificationOption[],
  provider?: AiProvider
): AskResponseBody {
  return {
    answer: '',
    sources: [],
    timestamp: new Date().toISOString(),
    provider,
    sessionId,
    requiresClarification: true,
    followUpQuestion: `${question} Reply with option number or market name/date.`,
    followUpOptions: options
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<AskResponseBody | AskStreamEvent>) {
  const streamMode = isStreamRequest(req)
  let streamEnded = false

  const emitStreamEvent = (event: AskStreamEvent) => {
    if (!streamMode || streamEnded) return
    res.write(`${JSON.stringify(event)}\n`)
  }

  const emitStatus = (message: string) => {
    emitStreamEvent({ type: 'status', message })
  }

  const emitCli = (provider: AiProvider, stream: 'stdout' | 'stderr', text: string) => {
    if (!streamMode || !text) return
    const cleaned = text.replace(/\r/g, '')
    const lines = cleaned
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-10)

    for (const line of lines) {
      emitStreamEvent({
        type: 'cli',
        provider,
        stream,
        text: line.slice(0, 500)
      })
    }
  }

  const respond = (status: number, payload: AskResponseBody) => {
    if (!streamMode) {
      return res.status(status).json(payload)
    }

    res.statusCode = status
    if (status >= 400) {
      emitStreamEvent({ type: 'error', error: payload.error || `Request failed (${status})` })
    } else {
      emitStreamEvent({ type: 'final', data: payload })
    }

    if (!streamEnded) {
      streamEnded = true
      res.end()
    }

    return null
  }

  if (streamMode) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    ;(res as any).flushHeaders?.()
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return respond(405, {
      answer: '',
      sources: [],
      timestamp: new Date().toISOString(),
      sessionId: newSessionId(),
      error: 'Method not allowed'
    })
  }

  try {
    const body = (req.body || {}) as AskRequestBody
    const rawQuestion = (body.question || '').trim()

    if (!rawQuestion) {
      return respond(400, {
        answer: '',
        sources: [],
        timestamp: new Date().toISOString(),
        sessionId: newSessionId(),
        error: 'Question is required'
      })
    }

    const { sessionId, state } = getSession(body.sessionId)

    let question = rawQuestion
    let category = (body.category || state.lastCategory || 'weather').trim().toLowerCase()
    let forcedEventId: string | undefined

    if (state.pendingClarification) {
      const selected = resolveClarificationSelection(rawQuestion, state.pendingClarification.options)

      if (!selected) {
        return respond(200, clarificationResponse(
          sessionId,
          state.pendingClarification.question,
          state.pendingClarification.options,
          resolveAiProvider(body.provider || process.env.AI_PROVIDER)
        ))
      }

      question = state.pendingClarification.question
      category = state.pendingClarification.category
      forcedEventId = selected.id
      state.pendingClarification = undefined
    }

    const { webSearch, dataTools, mcpOnlyWeather } = inferExecutionOptions(question, category)
    emitStatus('Gathering market context...')

    const gatherer = getDataGatherer(category)
    const marketContext = await gatherer.gather(question, {
      baseUrl: resolveBaseUrl(req),
      forcedEventId,
      dataTools,
      session: {
        lastSelectedEventId: state.lastSelectedEventId || null
      }
    })

    if (marketContext.clarification) {
      state.pendingClarification = {
        question,
        category,
        options: marketContext.clarification.options
      }
      state.updatedAt = Date.now()
      state.lastCategory = category
      SESSION_STORE.set(sessionId, state)

      return respond(200, {
        ...clarificationResponse(
          sessionId,
          marketContext.clarification.question,
          marketContext.clarification.options,
          resolveAiProvider(body.provider || process.env.AI_PROVIDER)
        ),
        sources: marketContext.sources
      })
    }

    state.lastCategory = category
    if (marketContext.scope?.selectedEventId) {
      state.lastSelectedEventId = marketContext.scope.selectedEventId
    }
    state.updatedAt = Date.now()
    SESSION_STORE.set(sessionId, state)

    const apiReference = await loadApiReferenceText()
    const apiRoutingGuide = buildScopedApiRoutingGuide(question, apiReference)
    const sourceCatalog = buildSourceCatalog(marketContext.sources)

    const requiresExternalEvidence = !mcpOnlyWeather
      && category === 'weather'
      && isCurrentWeatherIntent(question)
      && weatherSnapshotNeedsFetch(marketContext)
    let effectiveWebSearch = shouldForceWebSearch(question, category, marketContext, webSearch, mcpOnlyWeather)

    const prompt = buildPrompt(question, gatherer.formatForPrompt(marketContext), sourceCatalog, {
      webSearch: effectiveWebSearch,
      dataTools,
      apiRoutingGuide,
      requireExternalEvidence: requiresExternalEvidence,
      mcpOnlyWeather
    })

    const provider = resolveAiProvider(body.provider || process.env.AI_PROVIDER)
    const mcpSpecs: AskMcpSpec[] = [
      {
        name: 'weather',
        label: 'weather',
        envPrefix: 'WEATHER_MCP',
        defaultUrl: getDefaultWeatherMcpUrl()
      },
      {
        name: 'polymarket',
        label: 'polymarket',
        envPrefix: 'POLYMARKET_MCP'
      },
      {
        name: 'news',
        label: 'news',
        envPrefix: 'NEWS_MCP'
      }
    ]
    const mcp: Partial<Record<AskMcpName, AiMcpServerOverride>> = {}
    for (const spec of mcpSpecs) {
      mcp[spec.name] = await resolveMcpRuntime(spec, emitStatus)
    }

    const timeoutMsEnv = Number(process.env.AI_TIMEOUT_MS)
    const codexTimeoutMsEnv = Number(process.env.AI_TIMEOUT_MS_CODEX)
    const codexDefaultTimeoutMs = effectiveWebSearch ? 180_000 : 120_000
    const providerDefaultTimeoutMs = provider === 'codex' ? codexDefaultTimeoutMs : 30_000
    const timeoutMs = Number.isFinite(timeoutMsEnv) && timeoutMsEnv > 0
      ? timeoutMsEnv
      : provider === 'codex' && Number.isFinite(codexTimeoutMsEnv) && codexTimeoutMsEnv > 0
        ? codexTimeoutMsEnv
        : providerDefaultTimeoutMs

    emitStatus(`Running ${provider}${effectiveWebSearch ? ' with web search' : ''}...`)
    let ai = await runAiPrompt(prompt, provider, {
      timeoutMs,
      enableWebSearch: effectiveWebSearch,
      mcp,
      onOutput: (event) => emitCli(provider, event.stream, event.text)
    })

    if (!ai.success) {
      return respond(500, {
        answer: '',
        error: ai.error || `Failed to get response from ${provider}`,
        sources: marketContext.sources,
        timestamp: new Date().toISOString(),
        provider,
        sessionId
      })
    }

    let parsed = parseAnswerAndCitations(ai.response, marketContext.sources)

    if (
      !mcpOnlyWeather
      &&
      !effectiveWebSearch
      && (
        parsed.needsExternalData
        || (questionDemandsFreshness(question) && answerSignalsMissingData(parsed.cleanAnswer || ai.response))
      )
    ) {
      emitStatus('Retrying with web search for better coverage...')
      const retryPrompt = buildPrompt(question, gatherer.formatForPrompt(marketContext), sourceCatalog, {
        webSearch: true,
        dataTools,
        apiRoutingGuide,
        requireExternalEvidence: true,
        mcpOnlyWeather
      })

      const retry = await runAiPrompt(retryPrompt, provider, {
        timeoutMs,
        enableWebSearch: true,
        mcp,
        onOutput: (event) => emitCli(provider, event.stream, event.text)
      })

      if (retry.success) {
        ai = retry
        effectiveWebSearch = true
        parsed = parseAnswerAndCitations(ai.response, marketContext.sources)
      }
    }

    if (effectiveWebSearch && requiresExternalEvidence && !parsed.webUrls.length) {
      emitStatus('Retrying to collect concrete external links...')
      const strictRetryPrompt = buildPrompt(question, gatherer.formatForPrompt(marketContext), sourceCatalog, {
        webSearch: true,
        dataTools,
        apiRoutingGuide,
        requireExternalEvidence: true,
        strictExternalRetry: true,
        mcpOnlyWeather
      })

      const strictRetry = await runAiPrompt(strictRetryPrompt, provider, {
        timeoutMs,
        enableWebSearch: true,
        mcp,
        onOutput: (event) => emitCli(provider, event.stream, event.text)
      })

      if (strictRetry.success) {
        ai = strictRetry
        parsed = parseAnswerAndCitations(ai.response, marketContext.sources)
      }
    }

    const fallbackSources = pickSourcesByIds(marketContext.sources, marketContext.selectedSourceIds)
    const localSources = parsed.citedSources.length ? parsed.citedSources : fallbackSources
    const modelAnswer = parsed.cleanAnswer || ai.response
    const answer = enforceNeutralDataOnlyAnswer(modelAnswer)
    if (answer !== modelAnswer) {
      emitStatus('Removed recommendation language; returning neutral data-only analysis.')
    }
    const parsedWebUrls = mcpOnlyWeather
      ? []
      : parsed.webUrls.length
        ? parsed.webUrls
        : extractUrlsFromText(answer)
    const webSources = parsedWebUrls.map((url, index) => buildWebSource(url, index + 1))
    const responseSources = mergeSources(localSources, webSources)

    return respond(200, {
      answer,
      sources: responseSources,
      timestamp: new Date().toISOString(),
      provider,
      sessionId
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process question'
    return respond(500, {
      answer: '',
      sources: [],
      timestamp: new Date().toISOString(),
      sessionId: newSessionId(),
      error: message
    })
  }
}
