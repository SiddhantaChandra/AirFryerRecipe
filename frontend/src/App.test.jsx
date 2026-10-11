import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import App from './App'

describe('App Smoke Test & Theme Toggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('renders application header and placeholder discovery heading', () => {
    render(<App />)
    expect(screen.getByText('Air Fryer Shorts')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: /discover air fryer recipes/i })).toBeInTheDocument()
  })

  it('toggles data-theme attribute on root element when theme buttons are clicked', () => {
    render(<App />)

    const darkBtn = screen.getByTestId('theme-btn-dark')
    fireEvent.click(darkBtn)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    const lightBtn = screen.getByTestId('theme-btn-light')
    fireEvent.click(lightBtn)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
