import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom'
import { useTheme } from './theme'
import { Sun, Moon, Monitor } from 'lucide-react'

function RootLayout() {
  const { theme, resolvedTheme, setTheme } = useTheme()

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header (DESIGNS.md §5.3) */}
      <header
        style={{
          height: '64px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-text)' }}>
            Air Fryer Shorts
          </span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '999px',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-accent)',
            }}
          >
            Archive
          </span>
        </div>

        {/* Theme Selector (DESIGNS.md §3.2) */}
        <div
          role="group"
          aria-label="Theme selector"
          style={{
            display: 'flex',
            gap: '4px',
            backgroundColor: 'var(--color-surface)',
            padding: '4px',
            borderRadius: '10px',
            border: '1px solid var(--color-border)',
          }}
        >
          <button
            type="button"
            data-testid="theme-btn-light"
            onClick={() => setTheme('light')}
            aria-pressed={theme === 'light'}
            title="Light theme"
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: theme === 'light' ? 'var(--color-bg)' : 'transparent',
              color: theme === 'light' ? 'var(--color-accent)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            <Sun size={15} />
            <span>Light</span>
          </button>

          <button
            type="button"
            data-testid="theme-btn-dark"
            onClick={() => setTheme('dark')}
            aria-pressed={theme === 'dark'}
            title="Dark theme"
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: theme === 'dark' ? 'var(--color-bg)' : 'transparent',
              color: theme === 'dark' ? 'var(--color-accent)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            <Moon size={15} />
            <span>Dark</span>
          </button>

          <button
            type="button"
            data-testid="theme-btn-system"
            onClick={() => setTheme('system')}
            aria-pressed={theme === 'system'}
            title="System theme"
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: theme === 'system' ? 'var(--color-bg)' : 'transparent',
              color: theme === 'system' ? 'var(--color-accent)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            <Monitor size={15} />
            <span>System ({resolvedTheme})</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '32px 24px', maxWidth: '1280px', width: '100%', margin: '0 auto' }}>
        <Outlet />
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--color-border)', padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>
        Air Fryer Shorts Archive &bull; Curated community recipes from YouTube Shorts
      </footer>
    </div>
  )
}

function DiscoverPlaceholder() {
  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '8px' }}>
          Discover air fryer recipes
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '15px' }}>
          Browse curated recipes by diet, ingredients, and cook time. (Foundation Scaffold placeholder)
        </p>
      </div>

      <div
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          backgroundColor: 'var(--color-surface)',
          borderRadius: '12px',
          border: '1px solid var(--color-border)',
        }}
      >
        <p style={{ fontSize: '15px', color: 'var(--color-text)', fontWeight: 500 }}>
          Phase 1 Foundation Scaffold is active.
        </p>
        <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
          Catalog models and admin curation arrive in Phase 2; discovery grid and player in Phase 3.
        </p>
      </div>
    </div>
  )
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <DiscoverPlaceholder />,
      },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
