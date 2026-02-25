const GDELT_DOC_API = process.env.NEWS_API_BASE_URL || 'https://api.gdeltproject.org/api/v2/doc/doc'

export const MCP_SERVER_INFO = {
  name: 'polyterminal-news-mcp',
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

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
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

function normalizeArticles(payload) {
  const articles = Array.isArray(payload?.articles) ? payload.articles : []
  return articles.map((article) => ({
    title: article?.title || null,
    url: article?.url || null,
    domain: article?.domain || null,
    sourceCountry: article?.sourcecountry || null,
    language: article?.language || null,
    seenDate: article?.seendate || null,
    socialImage: article?.socialimage || null
  }))
}

function buildQueryString(query, domain) {
  const normalizedQuery = String(query || '').trim()
  const normalizedDomain = String(domain || '').trim()
  if (!normalizedDomain) return normalizedQuery
  if (!normalizedQuery) return `domain:${normalizedDomain}`
  return `${normalizedQuery} AND domain:${normalizedDomain}`
}

async function callTool(name, args) {
  if (name === 'news_search_articles') {
    const query = String(args?.query || '').trim()
    if (!query) {
      return textResult({
        ok: false,
        error: 'query is required.'
      })
    }

    const maxRecords = clampNumber(args?.maxRecords, 1, 250, 20)
    const url = buildUrl(GDELT_DOC_API, {
      query: buildQueryString(query, args?.domain),
      mode: 'artlist',
      format: 'json',
      maxrecords: maxRecords,
      sort: String(args?.sort || 'datedesc').trim() || 'datedesc',
      timespan: args?.timespan
    })
    const response = await fetchJson(url)
    const payload = response.json || {}
    const articles = normalizeArticles(payload)

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      articleCount: articles.length,
      articles
    })
  }

  if (name === 'news_topic_snapshot') {
    const topic = String(args?.topic || '').trim() || 'polymarket prediction market'
    const maxRecords = clampNumber(args?.maxRecords, 1, 250, 15)
    const timespan = String(args?.timespan || '').trim() || '7days'
    const query = String(args?.query || '').trim() || topic

    const url = buildUrl(GDELT_DOC_API, {
      query: buildQueryString(query, args?.domain),
      mode: 'artlist',
      format: 'json',
      maxrecords: maxRecords,
      sort: 'datedesc',
      timespan
    })
    const response = await fetchJson(url)
    const payload = response.json || {}
    const articles = normalizeArticles(payload)

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      topic,
      timespan,
      articleCount: articles.length,
      articles
    })
  }

  if (name === 'news_topic_timeline') {
    const query = String(args?.query || '').trim()
    if (!query) {
      return textResult({
        ok: false,
        error: 'query is required.'
      })
    }

    const url = buildUrl(GDELT_DOC_API, {
      query: buildQueryString(query, args?.domain),
      mode: 'timelinevolraw',
      format: 'json',
      timespan: String(args?.timespan || '').trim() || '30days'
    })
    const response = await fetchJson(url)
    const payload = response.json || {}
    const timeline = Array.isArray(payload?.timeline) ? payload.timeline : []

    return textResult({
      ok: response.ok,
      status: response.status,
      sourceUrl: url,
      timeline
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
    name: 'news_search_articles',
    description: 'Search recent news articles by keyword query (GDELT Doc API).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
        domain: { type: 'string' },
        timespan: { type: 'string' },
        maxRecords: { type: 'number' },
        sort: { type: 'string' }
      }
    }
  },
  {
    name: 'news_topic_snapshot',
    description: 'Get a quick recent-coverage snapshot for a topic.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        topic: { type: 'string' },
        query: { type: 'string' },
        domain: { type: 'string' },
        timespan: { type: 'string' },
        maxRecords: { type: 'number' }
      }
    }
  },
  {
    name: 'news_topic_timeline',
    description: 'Get timeline volume for a query/topic from GDELT.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
        domain: { type: 'string' },
        timespan: { type: 'string' }
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
