import { FormEvent, useEffect, useRef, useState } from 'react'
import type { AiProvider } from '@/types'

interface CommandBarProps {
  loading: boolean
  provider: AiProvider
  onProviderChange: (provider: AiProvider) => void
  onSubmit: (question: string) => void
}

export default function CommandBar({
  loading,
  provider,
  onProviderChange,
  onSubmit
}: CommandBarProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      if (!isShortcut) return
      event.preventDefault()
      inputRef.current?.focus()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const question = value.trim()
    if (!question || loading) return
    onSubmit(question)
    setValue('')
  }

  return (
    <form className="command-bar" onSubmit={handleSubmit}>
      <div className="command-main">
        <div className="provider-toggle" role="group" aria-label="AI provider">
          <button
            type="button"
            className={`provider-toggle-btn ${provider === 'codex' ? 'active' : ''}`}
            onClick={() => onProviderChange('codex')}
            disabled={loading}
            aria-pressed={provider === 'codex'}
          >
            C
          </button>
          <button
            type="button"
            className={`provider-toggle-btn ${provider === 'claude' ? 'active' : ''}`}
            onClick={() => onProviderChange('claude')}
            disabled={loading}
            aria-pressed={provider === 'claude'}
          >
            A
          </button>
        </div>
        <input
          ref={inputRef}
          className="search-input command-input"
          placeholder="Ask about markets…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={loading}
          aria-label="Ask about markets"
        />
      </div>
    </form>
  )
}
