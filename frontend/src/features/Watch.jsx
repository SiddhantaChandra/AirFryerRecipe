import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Share2, MoreHorizontal } from 'lucide-react'
import { catalog } from '../lib/api'
import { YouTubePlayer } from '../components/YouTubePlayer'
import { ThemeControls } from '../components/ThemeControls'
import { AccountActions } from '../components/AccountActions'
import { discoverURL, parseQuery, queryString, watchOrigin, watchURL, writeRecord } from '../lib/discovery'

export function ShareActions({ video }) {
  const [feedback, setFeedback] = useState('')
  const details = useRef(null)
  const trigger = useRef(null)
  const firstLink = useRef(null)
  async function copy() {
    try {
      await window.navigator.clipboard.writeText(window.location.href.split('?')[0].split('#')[0])
      setFeedback('App link copied.')
    } catch { setFeedback('Could not copy. Copy the address from your browser.') }
  }
  async function share() {
    if (!window.navigator.share) return copy()
    try {
      await window.navigator.share({ title: video.recipe_name, url: window.location.href.split('?')[0].split('#')[0] })
      setFeedback('Share sheet opened.')
    } catch (error) { if (error.name !== 'AbortError') await copy() }
  }
  return <div className="watch-actions">
    <button onClick={share}><Share2 size={20} aria-hidden="true" />Share</button>
    <details ref={details} onToggle={() => { if (details.current.open) firstLink.current?.focus() }} onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        details.current.open = false
        trigger.current.focus({ preventScroll: true })
      }
    }}><summary ref={trigger}><MoreHorizontal size={20} aria-hidden="true" />More</summary>
      <div className="more-panel"><a ref={firstLink} href={video.canonical_url}>Original link</a><button onClick={copy}>Copy app link</button></div>
    </details>
    <p className="action-feedback" role="status">{feedback}</p>
  </div>
}

export function Watch({ slug }) {
  const serverQuery = document.getElementById('watch-context')
  const query = serverQuery ? JSON.parse(serverQuery.textContent) : parseQuery(window.location.search)
  const context = queryString(query)
  const [origin] = useState(watchOrigin)
  const neighborPath = `${encodeURIComponent(slug)}/neighbors/${context ? `?${context}` : ''}`
  const recipe = useQuery({ queryKey: ['video', slug], queryFn: ({ signal }) => catalog(`${encodeURIComponent(slug)}/`, signal) })
  const neighbors = useQuery({ queryKey: ['neighbors', slug, context], queryFn: ({ signal }) => catalog(neighborPath, signal) })
  const [navigationError, setNavigationError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const missing = unavailable || recipe.error?.status === 404 || neighbors.error?.status === 404
  const navigationId = useId()
  function backToResults(event) {
    if (origin && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); history.go(-origin.steps) }
  }
  useEffect(() => {
    const content = document.getElementById('recipe-details')
    if (content) {
      content.hidden = missing
      if (missing) content.replaceChildren()
    }
    if (missing) {
      document.title = 'Recipe unavailable · Air Fryer Shorts'
      document.querySelectorAll('meta[property^="og:"],meta[name^="twitter:"],meta[name="description"]').forEach(meta => meta.remove())
    }
  }, [missing])
  const refetch = useRef(null)
  refetch.current = () => { recipe.refetch(); neighbors.refetch() }
  useEffect(() => {
    const revalidate = () => refetch.current()
    window.addEventListener('pageshow', revalidate)
    return () => window.removeEventListener('pageshow', revalidate)
  }, [])
  const navigating = useRef(false)
  async function navigate(direction) {
    if (navigating.current) return
    navigating.current = true
    try {
      const current = await catalog(neighborPath)
      if (current[direction]) {
        const target = watchURL(current[direction].slug, query)
        if (origin) writeRecord('archive-watch-pending', { ...origin, target, steps: origin.steps + 1 })
        window.location.assign(target)
      }
      else setNavigationError(`No ${direction} recipe is available.`)
    } catch (error) {
      setNavigationError(error.message)
      // Recheck the current recipe too: a stale page must lose its player/details
      // after navigation discovers that an admin has hidden it.
      if (error.status === 404) {
        setUnavailable(true)
        await recipe.refetch()
      }
    }
    finally { navigating.current = false }
  }
  const navigation = useRef(navigate)
  navigation.current = navigate
  useEffect(() => {
    function key(event) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.target.closest('input,textarea,select,button,a,summary,details,[role="dialog"],[role="menu"],[contenteditable],iframe')) return
      if (document.querySelector('details[open], dialog[open]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        navigation.current(event.key === 'ArrowLeft' ? 'previous' : 'next')
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  if (recipe.isPending) return <p role="status">Loading player…</p>
  if (recipe.isError || missing) return <div role="alert">{missing && <h1>Recipe unavailable</h1>}<p>{missing ? 'Recipe no longer available in the archive.' : recipe.error.message}</p>{!missing && <button onClick={() => recipe.refetch()}>Retry</button>}<a href={discoverURL(query)} onClick={backToResults}>Back to results</a></div>
  return <>
    {(context || origin) && <a className="back-results" href={discoverURL(query)} onClick={backToResults}>Back to results</a>}
    <div className="watch-preferences"><AccountActions /><ThemeControls /></div>
    <div className="watch-interactive"><YouTubePlayer key={recipe.data.id} video={recipe.data} /><ShareActions video={recipe.data} /></div>
    {neighbors.data?.in_context === false && <p role="status">This recipe no longer matches your search or filters. Its content remains available. Return to results to choose another recipe.</p>}
    <nav className="watch-navigation" aria-label={context ? 'Filtered recipe navigation' : 'Newest recipe navigation'}>
      {['previous', 'next'].map(direction => <div key={direction}><button disabled={!neighbors.data?.[direction]} aria-describedby={neighbors.isSuccess && !neighbors.data[direction] ? `${navigationId}-${direction}` : undefined} onClick={() => navigate(direction)}>{direction === 'previous' ? 'Previous' : 'Next'}</button>
        {neighbors.isSuccess && !neighbors.data[direction] && <small id={`${navigationId}-${direction}`}>{neighbors.data.in_context === false ? 'Recipe is outside these results' : context ? `No ${direction} matching recipe` : direction === 'previous' ? 'Newest recipe' : 'Oldest recipe'}</small>}</div>)}
    </nav>
    {neighbors.isError && <p role="alert">Navigation could not load. <button onClick={() => neighbors.refetch()}>Retry navigation</button></p>}
    <p role="status">{navigationError}</p>
  </>
}
