import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

const THEME_KEY = 'poly-terminal-theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY) as Theme | null
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored)
      return
    }

    setTheme('dark')
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  return { theme, setTheme }
}
