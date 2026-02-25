#!/usr/bin/env node

import http from 'node:http'
import { handleMcpMessage, MCP_SERVER_INFO } from './polymarket-mcp-core.mjs'

const host = process.env.POLYMARKET_MCP_HOST || '127.0.0.1'
const port = Number(process.env.POLYMARKET_MCP_PORT || 8788)
const mcpPath = process.env.POLYMARKET_MCP_PATH || '/mcp'
const maxBodyBytes = Number(process.env.POLYMARKET_MCP_MAX_BODY_BYTES || 1024 * 1024)

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0
    const chunks = []

    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBodyBytes) {
        reject(new Error('Payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })

    req.on('error', (error) => {
      reject(error)
    })
  })
}

async function handlePostMcp(req, res) {
  let raw = ''
  try {
    raw = await readBody(req)
  } catch (error) {
    sendJson(res, 413, {
      jsonrpc: '2.0',
      error: { code: -32000, message: error instanceof Error ? error.message : 'Failed to read request body' }
    })
    return
  }

  let parsed
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    sendJson(res, 400, {
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' }
    })
    return
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed]
  const responses = []

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const response = await handleMcpMessage(message)
    if (response) responses.push(response)
  }

  if (Array.isArray(parsed)) {
    sendJson(res, 200, responses)
    return
  }

  if (!responses.length) {
    res.writeHead(204)
    res.end()
    return
  }

  sendJson(res, 200, responses[0])
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      Allow: 'GET,POST,OPTIONS'
    })
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, {
      ok: true,
      server: MCP_SERVER_INFO.name,
      version: MCP_SERVER_INFO.version
    })
    return
  }

  if (req.url !== mcpPath) {
    sendJson(res, 404, {
      error: `Not found. Use ${mcpPath} for MCP or /health for health check.`
    })
    return
  }

  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      message: 'MCP endpoint is running. Send JSON-RPC requests via POST.',
      endpoint: mcpPath,
      server: MCP_SERVER_INFO
    })
    return
  }

  if (req.method === 'POST') {
    await handlePostMcp(req, res)
    return
  }

  sendJson(res, 405, {
    error: 'Method not allowed'
  })
})

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`${MCP_SERVER_INFO.name} listening on http://${host}:${port}${mcpPath}`)
})
