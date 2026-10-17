import { useEffect, useRef } from 'react'
import { createBrowserRouter, RouterProvider, Outlet, useLocation } from 'react-router-dom'
import { ThemeControls } from '../components/ThemeControls'
import { Discover, RecipeSearch } from '../features/Discover'
import { AccountActions } from '../components/AccountActions'
import { AccountEntry, Settings } from '../features/Accounts'

function Shell() {
  const location = useLocation()
  const main = useRef(null)
  const previousPath = useRef(location.pathname)
  useEffect(() => {
    if (location.pathname === '/') document.title = 'Discover air fryer recipes · Air Fryer Shorts'
    if (previousPath.current !== location.pathname) main.current?.focus({ preventScroll: true })
    previousPath.current = location.pathname
  }, [location.pathname])
  return <div className="app-shell">
    <a className="skip-link" href="#content">Skip to content</a>
    <header className="site-header"><a className="brand" href="/">Air Fryer Shorts</a>{location.pathname === '/' && <div id="header-search"><RecipeSearch /></div>}<div className="header-actions"><AccountActions /><ThemeControls /></div></header>
    <main ref={main} tabIndex={-1} id="content" className="page">{location.state?.accountDeleted && <p role="status" className="success-feedback">Your account has been deleted.</p>}<Outlet /></main>
    <footer className="site-footer">Manually curated recipes · Official YouTube playback</footer>
  </div>
}

const router = createBrowserRouter([
  { element: <Shell />, children: [
    { path: '/', element: <Discover showSearch={false} /> },
    { path: '/login', element: <AccountEntry /> },
    { path: '/signup', element: <AccountEntry signup /> },
    { path: '/settings', element: <Settings /> },
  ] },
  { path: '*', element: <main className="page"><h1>Page not found</h1><a href="/">Discover recipes</a></main> },
])

export function AppRouter() { return <RouterProvider router={router} /> }
