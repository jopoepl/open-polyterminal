#!/usr/bin/env node

import { handleMcpMessage } from './news-mcp-core.mjs'

function send(message) {
  const payload = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`
  process.stdout.write(header + payload)
}

let buffer = Buffer.alloc(0)

async function processBuffer() {
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return

    const headerText = buffer.slice(0, headerEnd).toString('utf8')
    const headers = {}
    for (const line of headerText.split('\r\n')) {
      const idx = line.indexOf(':')
      if (idx === -1) continue
      const key = line.slice(0, idx).trim().toLowerCase()
      const value = line.slice(idx + 1).trim()
      headers[key] = value
    }

    const length = Number(headers['content-length'])
    if (!Number.isFinite(length) || length < 0) {
      buffer = Buffer.alloc(0)
      return
    }

    const messageStart = headerEnd + 4
    const messageEnd = messageStart + length
    if (buffer.length < messageEnd) return

    const payload = buffer.slice(messageStart, messageEnd).toString('utf8')
    buffer = buffer.slice(messageEnd)

    let message
    try {
      message = JSON.parse(payload)
    } catch {
      continue
    }

    if (!message || typeof message !== 'object') continue
    const response = await handleMcpMessage(message)
    if (response) send(response)
  }
}

process.stdin.on('data', async (chunk) => {
  const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  buffer = Buffer.concat([buffer, data])
  await processBuffer()
})

process.stdin.on('end', () => {
  process.exit(0)
})
