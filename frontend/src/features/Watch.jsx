import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Share2, MoreHorizontal } from 'lucide-react'
import { catalog } from '../lib/api'
import { YouTubePlayer } from '../components/YouTubePlayer'
import { ThemeControls } from '../components/ThemeControls'

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
      if (event.key === 'Escape') { details.current.open = false; trigger.current.focus() }
    }}><summary ref={trigger}><MoreHorizontal size={20} aria-hidden="true" />More</summary>
      <div className="more-panel"><a ref={firstLink} href={video.canonical_url}>Original link</a><button onClick={copy}>Copy app link</button></div>
    </details>
    <p className="action-feedback" role="status">{feedback}</p>
  </div>
}

export function Watch({ slug }) {
  const recipe = useQuery({ queryKey: ['video', slug], queryFn: ({ signal }) => catalog(`${encodeURIComponent(slug)}/`, signal) })
  const neighbors = useQuery({ queryKey: ['neighbors', slug], queryFn: ({ signal }) => catalog(`${encodeURIComponent(slug)}/neighbors/`, signal) })
  const [navigationError, setNavigationError] = useState('')
  useEffect(() => {
    const content = document.getElementById('recipe-details')
    if (content) content.hidden = recipe.error?.status === 404
  }, [recipe.error])
  const navigating = useRef(false)
  async function navigate(direction) {
    if (navigating.current) return
    navigating.current = true
    try {
      const current = await catalog(`${encodeURIComponent(slug)}/neighbors/`)
      if (current[direction]) window.location.assign(`/shorts/${encodeURIComponent(current[direction].slug)}`)
      else setNavigationError(`No ${direction} recipe is available.`)
    } catch (error) { setNavigationError(error.message) }
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
  if (recipe.isError) return <div role="alert"><p>{recipe.error.message}</p>{recipe.error.status !== 404 && <button onClick={() => recipe.refetch()}>Retry</button>}</div>
  return <>
    <div className="watch-preferences"><ThemeControls /></div>
    <div className="watch-interactive"><YouTubePlayer key={recipe.data.id} video={recipe.data} /><ShareActions video={recipe.data} /></div>
    <nav className="watch-navigation" aria-label="Newest recipe navigation">
      {['previous', 'next'].map(direction => <div key={direction}><button disabled={!neighbors.data?.[direction]} onClick={() => navigate(direction)}>{direction === 'previous' ? 'Previous' : 'Next'}</button>
        {neighbors.isSuccess && !neighbors.data[direction] && <small>{direction === 'previous' ? 'Newest recipe' : 'Oldest recipe'}</small>}</div>)}
    </nav>
    {neighbors.isError && <p role="alert">Navigation could not load. <button onClick={() => neighbors.refetch()}>Retry navigation</button></p>}
    <p role="status">{navigationError}</p>
  </>
}
