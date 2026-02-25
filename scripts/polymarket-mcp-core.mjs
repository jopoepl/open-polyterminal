const GAMMA_API = 'https://gamma-api.polymarket.com'
const CLOB_API = 'https://clob.polymarket.com'
const DATA_API = 'https://data-api.polymarket.com'

export const MCP_SERVER_INFO = {
  name: 'polyterminal-polymarket-mcp',
  version: '0.1.0'
}

function buildUrl(base, query) {
  const url = new URL(base)
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function ensureNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampNumber(value, min, max, fallback) {
  const parsed = ensureNumber(value, fallback)
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

function textResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ]
  }
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    const text = await response.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url,
      json,
      text: json ? undefined : text
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error instanceof Error ? error.message : 'request failed',
      url,
      json: null
    }
  } finally {
    clearTimeout(timeout)
  }
}

function summarizeEvent(event) {
  return {
    id: event?.id || null,
    slug: event?.slug || null,
    title: event?.title || null,
    category: event?.category || null,
    active: event?.active ?? null,
    closed: event?.closed ?? null,
    archived: event?.archived ?? null,
    startDate: event?.startDate || null,
    endDate: event?.endDate || null,
    volume: event?.volume ?? null,
    volume24hr: event?.volume24hr ?? event?.volume24h ?? null,
    liquidity: event?.liquidity ?? null,
    marketCount: Array.isArray(event?.markets) ? event.markets.length : event?.marketCount ?? null
  }
}

function summarizeMarket(market) {
  return {
    id: market?.id || null,
    slug: market?.slug || null,
    question: market?.question || null,
    active: market?.active ?? null,
    closed: market?.closed ?? null,
    archived: market?.archived ?? null,
    eventId: market?.eventId || market?.event || null,
    conditionId: market?.conditionId || null,
    tokenId: market?.token_id || market?.tokenId || null,
    volume: market?.volume ?? null,
    volume24hr: market?.volume24hr ?? market?.volume24h ?? null,
    liquidity: market?.liquidity ?? null,
    endDate: market?.endDate || null,
    resolutionSource: market?.resolutionSource || null
  }
}

function normalizeArrayResponse(responseJson, fallbackKey) {
  if (Array.isArray(responseJson)) return responseJson
  if (Array.isArray(responseJson?.[fallbackKey])) return responseJson[fallbackKey]
  return []
}

async function callTool(name, args) {
  if (name === 'pm_status') {
    const response = await fetchJson(`${GAMMA_API}/status`)
    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: response.url,
      statusPayload: response.json || response.text || null
    })
  }

  if (name === 'pm_search') {
    const query = String(args?.query || '').trim()
    if (!query) {
      return textResult({
        ok: false,
        error: 'query is required.'
      })
    }

    const limitPerType = clampNumber(args?.limitPerType, 1, 200, 20)
    const url = buildUrl(`${GAMMA_API}/public-search`, {
      q: query,
      limit_per_type: limitPerType
    })

    const response = await fetchJson(url)
    const payload = response.json || {}
    const events = Array.isArray(payload?.events) ? payload.events : []
    const markets = Array.isArray(payload?.markets) ? payload.markets : []

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      eventCount: events.length,
      marketCount: markets.length,
      events: events.map(summarizeEvent),
      markets: markets.map(summarizeMarket)
    })
  }

  if (name === 'pm_list_events') {
    const limit = clampNumber(args?.limit, 1, 200, 25)
    const offset = clampNumber(args?.offset, 0, 100000, 0)
    const url = buildUrl(`${GAMMA_API}/events`, {
      limit,
      offset,
      active: args?.active,
      closed: args?.closed,
      archived: args?.archived,
      category: args?.category,
      tag_id: args?.tagId,
      order: args?.order,
      ascending: args?.ascending
    })

    const response = await fetchJson(url)
    const events = normalizeArrayResponse(response.json, 'events')

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      count: events.length,
      events: events.map(summarizeEvent)
    })
  }

  if (name === 'pm_list_markets') {
    const limit = clampNumber(args?.limit, 1, 500, 50)
    const offset = clampNumber(args?.offset, 0, 100000, 0)
    const url = buildUrl(`${GAMMA_API}/markets`, {
      limit,
      offset,
      active: args?.active,
      closed: args?.closed,
      archived: args?.archived,
      event_id: args?.eventId,
      tag_id: args?.tagId,
      order: args?.order,
      ascending: args?.ascending
    })

    const response = await fetchJson(url)
    const markets = normalizeArrayResponse(response.json, 'markets')

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      count: markets.length,
      markets: markets.map(summarizeMarket)
    })
  }

  if (name === 'pm_get_event') {
    const eventId = String(args?.eventId || '').trim()
    const slug = String(args?.slug || '').trim()

    if (!eventId && !slug) {
      return textResult({
        ok: false,
        error: 'Provide eventId or slug.'
      })
    }

    const url = eventId
      ? `${GAMMA_API}/events/${encodeURIComponent(eventId)}`
      : `${GAMMA_API}/events/slug/${encodeURIComponent(slug)}`
    const response = await fetchJson(url)
    const event = response.json || null

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      summary: event ? summarizeEvent(event) : null,
      event
    })
  }

  if (name === 'pm_get_market') {
    const marketId = String(args?.marketId || '').trim()
    const slug = String(args?.slug || '').trim()

    if (!marketId && !slug) {
      return textResult({
        ok: false,
        error: 'Provide marketId or slug.'
      })
    }

    const url = marketId
      ? `${GAMMA_API}/markets/${encodeURIComponent(marketId)}`
      : `${GAMMA_API}/markets/slug/${encodeURIComponent(slug)}`
    const response = await fetchJson(url)
    const market = response.json || null

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      summary: market ? summarizeMarket(market) : null,
      market
    })
  }

  if (name === 'pm_get_trades') {
    const url = buildUrl(`${DATA_API}/trades`, {
      asset_id: args?.assetId,
      market: args?.market,
      user: args?.user,
      address: args?.address,
      side: args?.side,
      limit: clampNumber(args?.limit, 1, 500, 100),
      offset: clampNumber(args?.offset, 0, 100000, 0)
    })
    const response = await fetchJson(url)
    const trades = normalizeArrayResponse(response.json, 'trades')

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      tradeCount: trades.length,
      trades
    })
  }

  if (name === 'pm_get_positions') {
    const user = String(args?.user || '').trim()
    const address = String(args?.address || '').trim()
    if (!user && !address) {
      return textResult({
        ok: false,
        error: 'Provide user or address.'
      })
    }

    const url = buildUrl(`${DATA_API}/positions`, {
      user: user || undefined,
      address: address || undefined,
      market: args?.market,
      redeemable: args?.redeemable,
      sizeThreshold: args?.sizeThreshold,
      limit: clampNumber(args?.limit, 1, 500, 200),
      offset: clampNumber(args?.offset, 0, 100000, 0)
    })
    const response = await fetchJson(url)
    const positions = normalizeArrayResponse(response.json, 'positions')

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      positionCount: positions.length,
      positions
    })
  }

  if (name === 'pm_get_orderbook') {
    const tokenId = String(args?.tokenId || '').trim()
    if (!tokenId) {
      return textResult({
        ok: false,
        error: 'tokenId is required.'
      })
    }

    const url = buildUrl(`${CLOB_API}/book`, { token_id: tokenId })
    const response = await fetchJson(url)

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      book: response.json || null
    })
  }

  if (name === 'pm_get_price_history') {
    const tokenId = String(args?.tokenId || '').trim()
    if (!tokenId) {
      return textResult({
        ok: false,
        error: 'tokenId is required.'
      })
    }

    const interval = String(args?.interval || '').trim()
    const fidelity = clampNumber(args?.fidelity, 1, 10_080, 5)
    const nowTs = Math.floor(Date.now() / 1000)
    const endTs = clampNumber(args?.endTs, 0, 4_102_444_800, nowTs)
    const startTs = clampNumber(args?.startTs, 0, endTs, Math.max(0, endTs - (24 * 60 * 60)))

    const query = interval
      ? { market: tokenId, interval, fidelity }
      : { market: tokenId, startTs, endTs, fidelity }
    const url = buildUrl(`${CLOB_API}/prices-history`, query)
    const response = await fetchJson(url)
    const history = Array.isArray(response.json?.history) ? response.json.history : []

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      pointCount: history.length,
      history
    })
  }

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Unknown tool: ${name}`
      }
    ]
  }
}

export const MCP_TOOLS = [
  {
    name: 'pm_status',
    description: 'Check Gamma API status.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: 'pm_search',
    description: 'Search Polymarket entities (events and markets) using public search.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limitPerType: { type: 'number' }
      }
    }
  },
  {
    name: 'pm_list_events',
    description: 'List Polymarket events with filters and sorting.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'number' },
        offset: { type: 'number' },
        active: { type: 'boolean' },
        closed: { type: 'boolean' },
        archived: { type: 'boolean' },
        category: { type: 'string' },
        tagId: { type: ['number', 'string'] },
        order: { type: 'string' },
        ascending: { type: 'boolean' }
      }
    }
  },
  {
    name: 'pm_list_markets',
    description: 'List Polymarket markets with filters and sorting.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'number' },
        offset: { type: 'number' },
        active: { type: 'boolean' },
        closed: { type: 'boolean' },
        archived: { type: 'boolean' },
        eventId: { type: ['number', 'string'] },
        tagId: { type: ['number', 'string'] },
        order: { type: 'string' },
        ascending: { type: 'boolean' }
      }
    }
  },
  {
    name: 'pm_get_event',
    description: 'Fetch a Polymarket event by event ID or event slug.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        eventId: { type: 'string' },
        slug: { type: 'string' }
      }
    }
  },
  {
    name: 'pm_get_market',
    description: 'Fetch a Polymarket market by market ID or market slug.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        marketId: { type: 'string' },
        slug: { type: 'string' }
      }
    }
  },
  {
    name: 'pm_get_trades',
    description: 'Fetch recent trades from Polymarket Data API.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        assetId: { type: 'string' },
        market: { type: 'string' },
        user: { type: 'string' },
        address: { type: 'string' },
        side: { type: 'string' },
        limit: { type: 'number' },
        offset: { type: 'number' }
      }
    }
  },
  {
    name: 'pm_get_positions',
    description: 'Fetch user positions from Polymarket Data API.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        user: { type: 'string' },
        address: { type: 'string' },
        market: { type: 'string' },
        redeemable: { type: 'boolean' },
        sizeThreshold: { type: 'number' },
        limit: { type: 'number' },
        offset: { type: 'number' }
      }
    }
  },
  {
    name: 'pm_get_orderbook',
    description: 'Fetch orderbook depth for a Polymarket token_id.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tokenId'],
      properties: {
        tokenId: { type: 'string' }
      }
    }
  },
  {
    name: 'pm_get_price_history',
    description: 'Fetch historical prices for a Polymarket token_id.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tokenId'],
      properties: {
        tokenId: { type: 'string' },
        interval: { type: 'string' },
        startTs: { type: 'number' },
        endTs: { type: 'number' },
        fidelity: { type: 'number' }
      }
    }
  }
]

function result(id, payload) {
  return {
    jsonrpc: '2.0',
    id,
    result: payload
  }
}

function error(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  }
}

export async function handleMcpMessage(message) {
  const { id, method, params } = message || {}

  if (method === 'initialize') {
    return result(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: MCP_SERVER_INFO
    })
  }

  if (method === 'notifications/initialized') {
    return null
  }

  if (method === 'ping') {
    return result(id, {})
  }

  if (method === 'tools/list') {
    return result(id, { tools: MCP_TOOLS })
  }

  if (method === 'tools/call') {
    try {
      const toolResult = await callTool(params?.name, params?.arguments || {})
      return result(id, toolResult)
    } catch (toolError) {
      return result(id, {
        isError: true,
        content: [
          {
            type: 'text',
            text: toolError instanceof Error ? toolError.message : 'Tool execution failed'
          }
        ]
      })
    }
  }

  if (id !== undefined && id !== null) {
    return error(id, -32601, `Method not found: ${method}`)
  }

  return null
}
