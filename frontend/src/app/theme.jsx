import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
})

const getSystemTheme = () => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('airfryer_theme') || 'system'
    } catch {
      return 'system'
    }
  })

  const [resolvedTheme, setResolvedTheme] = useState(() => {
    if (theme === 'system') {
      return getSystemTheme()
    }
    return theme
  })

  useEffect(() => {
    const root = document.documentElement

    const applyTheme = (currentTheme) => {
      let active = currentTheme
      if (currentTheme === 'system') {
        active = getSystemTheme()
      }
      root.setAttribute('data-theme', active)
      root.style.colorScheme = active
      setResolvedTheme(active)
    }

    applyTheme(theme)

    try {
      localStorage.setItem('airfryer_theme', theme)
    } catch (_err) {
      // Ignore localStorage access restrictions
    }

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleSystemChange = () => {
        if (theme === 'system') {
          applyTheme('system')
        }
      }

      mediaQuery.addEventListener('change', handleSystemChange)
      return () => mediaQuery.removeEventListener('change', handleSystemChange)
    }
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
