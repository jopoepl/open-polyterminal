import { useCallback, useState } from 'react'
import type { AiProvider, AskResponse } from '@/types'

interface AskPayload {
  question: string
  category?: string
  provider?: AiProvider
  sessionId?: string
}

interface AskErrorBody {
  error?: string
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
  data: AskResponse
}

interface AskStreamErrorEvent {
  type: 'error'
  error: string
}

type AskStreamEvent =
  | AskStreamStatusEvent
  | AskStreamCliEvent
  | AskStreamFinalEvent
  | AskStreamErrorEvent

const MAX_LIVE_LINES = 120

export function useAsk() {
  const [result, setResult] = useState<AskResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liveOutput, setLiveOutput] = useState<string[]>([])

  const ask = useCallback(async (payload: AskPayload) => {
    const question = payload.question.trim()
    if (!question) return null

    setLoading(true)
    setError(null)
    setLiveOutput([])

    const pushLiveLine = (line: string) => {
      const text = line.trim()
      if (!text) return
      setLiveOutput((prev) => [...prev, text].slice(-MAX_LIVE_LINES))
    }

    try {
      const response = await fetch('/api/ask?stream=1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      const contentType = response.headers.get('content-type') || ''
      const isStream = contentType.includes('application/x-ndjson')

      if (isStream && response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let finalResult: AskResponse | null = null

        const parseLine = (line: string) => {
          try {
            return JSON.parse(line) as AskStreamEvent
          } catch {
            return null
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          let newlineIndex = buffer.indexOf('\n')
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trim()
            buffer = buffer.slice(newlineIndex + 1)
            newlineIndex = buffer.indexOf('\n')
            if (!line) continue

            const event = parseLine(line)
            if (!event) continue

            if (event.type === 'status') {
              pushLiveLine(`[status] ${event.message}`)
              continue
            }

            if (event.type === 'cli') {
              pushLiveLine(`[${event.provider} ${event.stream}] ${event.text}`)
              continue
            }

            if (event.type === 'error') {
              throw new Error(event.error || 'Request failed')
            }

            if (event.type === 'final') {
              finalResult = event.data
            }
          }
        }

        if (finalResult) {
          setResult(finalResult)
          return finalResult
        }

        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`)
        }

        throw new Error('Stream ended before a final response was received')
      }

      const isJson = contentType.includes('application/json')
      const body = isJson ? await response.json() : await response.text()

      if (!response.ok) {
        if (isJson) {
          const message = (body as AskErrorBody).error || `Request failed (${response.status})`
          throw new Error(message)
        }
        const plain = typeof body === 'string' ? body.replace(/\s+/g, ' ').trim() : ''
        const snippet = plain ? `: ${plain.slice(0, 180)}` : ''
        throw new Error(`Request failed (${response.status})${snippet}`)
      }

      if (!isJson) {
        const plain = typeof body === 'string' ? body.replace(/\s+/g, ' ').trim() : ''
        const snippet = plain ? `: ${plain.slice(0, 180)}` : ''
        throw new Error(`Invalid non-JSON response from /api/ask${snippet}`)
      }

      const typed = body as AskResponse
      setResult(typed)
      return typed
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to ask question'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => {
    setResult(null)
    setError(null)
    setLoading(false)
    setLiveOutput([])
  }, [])

  return {
    ask,
    result,
    loading,
    error,
    liveOutput,
    clear
  }
}
