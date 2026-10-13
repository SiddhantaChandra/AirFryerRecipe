import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { ThemeControls } from '../components/ThemeControls'
import { Discover } from '../features/Discover'

function Home() {
  return <div className="app-shell">
    <a className="skip-link" href="#content">Skip to content</a>
    <header className="site-header"><a className="brand" href="/">Air Fryer Shorts</a><ThemeControls /></header>
    <main id="content" className="page"><Discover /></main>
    <footer className="site-footer">Manually curated recipes · Official YouTube playback</footer>
  </div>
}

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '*', element: <main className="page"><h1>Page not found</h1><a href="/">Discover recipes</a></main> },
])

export function AppRouter() { return <RouterProvider router={router} /> }
