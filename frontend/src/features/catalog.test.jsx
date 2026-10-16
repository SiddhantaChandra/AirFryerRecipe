import { StrictMode } from 'react'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Discover, RecipeCard } from './Discover'
import { ShareActions, Watch } from './Watch'
import { YouTubePlayer } from '../components/YouTubePlayer'
import { loadYouTube } from '../lib/youtube'

vi.mock('../lib/youtube', async importOriginal => ({ ...await importOriginal(), loadYouTube: vi.fn() }))

const video = { id: 'one', slug: 'crispy-potatoes', recipe_name: 'Crispy potatoes आलू আলু', recipe_summary: 'Reviewed',
  diet_label: 'Vegetarian', cook_time_minutes: null, creator_name: null, thumbnail_url: null,
  meal_types: ['Snack'], cuisines: ['Indian', 'Other'], external_id: 'uLIOVZNFlPE',
  canonical_url: 'https://www.youtube.com/watch?v=uLIOVZNFlPE', availability: 'OK' }

function queryRender(element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.navigator.clipboard; delete window.navigator.share })

describe('Discovery states and honest card metadata', () => {
  it('reserves loading geometry, then renders empty state and search controls', async () => {
    let resolve
    vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done })))
    queryRender(<Discover />)
    expect(screen.getByLabelText('Loading recipes')).toBeInTheDocument()
    resolve({ ok: true, json: async () => ({ results: [], count: 0 }) })
    expect(await screen.findByRole('heading', { name: 'The archive is getting started' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBeInTheDocument()
    expect(screen.queryByText('Load more')).not.toBeInTheDocument()
  })

  it('shows retry after failure and recovers to published cards', async () => {
    let failed = true
    const fetch = vi.fn(url => Promise.resolve(url.includes('/filters/')
      ? { ok: true, json: async () => ({ count: 1 }) }
      : failed ? { ok: false, status: 503 } : { ok: true, json: async () => ({ results: [video], count: 1 }) }))
    vi.stubGlobal('fetch', fetch)
    queryRender(<Discover />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Recipes could not load')
    failed = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry recipes' }))
    expect(await screen.findByRole('link', { name: /Crispy potatoes/ })).toHaveAttribute('href', '/shorts/crispy-potatoes')
    expect(fetch.mock.calls[0][1].credentials).toBe('omit')
  })

  it('keeps one link, unknown cooking time, mixed script content, and two tags', () => {
    render(<RecipeCard video={video} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText('Cooking time unknown')).toBeInTheDocument()
    expect(screen.getByText('Source image unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Other')).not.toBeInTheDocument()
  })

  it('falls back when the provider image fails', () => {
    const { container } = render(<RecipeCard video={{ ...video, thumbnail_url: 'https://i.ytimg.com/image.jpg' }} />)
    fireEvent.error(container.querySelector('img'))
    expect(screen.getByText('Source image unavailable')).toBeInTheDocument()
  })

  it('exposes the full card title and known recipe cooking time', () => {
    render(<RecipeCard video={{ ...video, cook_time_minutes: 18, duration_seconds: 42, creator_name: 'Recipe creator' }} />)
    expect(screen.getByRole('heading')).toHaveAttribute('title', video.recipe_name)
    expect(screen.getByText('Cooking: 18 min')).toBeInTheDocument()
    expect(screen.queryByText(/42/)).not.toBeInTheDocument()
  })
})

describe('Official player lifetime and failures', () => {
  function provider() {
    const instances = []
    const Player = vi.fn(function (_frame, config) {
      const instance = { destroy: vi.fn(), pauseVideo: vi.fn(), config }
      instances.push(instance)
      return instance
    })
    loadYouTube.mockResolvedValue({ Player })
    return instances
  }

  it('destroys the old player and retains one iframe during source changes and unmount', async () => {
    const instances = provider()
    const { container, rerender, unmount } = render(<StrictMode><YouTubePlayer video={video} /></StrictMode>)
    await waitFor(() => expect(instances).toHaveLength(1))
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
    const frame = container.querySelector('iframe')
    expect(frame.src).toContain('www.youtube-nocookie.com')
    expect(frame.src).toContain('origin=http%3A%2F%2Flocalhost')
    expect(frame.referrerPolicy).toBe('strict-origin-when-cross-origin')
    rerender(<StrictMode><YouTubePlayer video={{ ...video, external_id: 'jNQXAC9IVRw' }} /></StrictMode>)
    await waitFor(() => expect(instances).toHaveLength(2))
    expect(instances[0].destroy).toHaveBeenCalledOnce()
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
    unmount()
    expect(instances[1].destroy).toHaveBeenCalledOnce()
  })

  it.each([[153, /identity\/configuration/], [100, /may be private or removed/], [150, /does not allow embedding/], [5, /could not load/]])('explains player error %i', async (code, message) => {
    const instances = provider()
    render(<YouTubePlayer video={video} />)
    await waitFor(() => expect(instances).toHaveLength(1))
    instances[0].config.events.onError({ data: code })
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry player' }) !== null).toBe([153, 5].includes(code))
  })

  it('shows tap-to-play on autoplay denial', async () => {
    const instances = provider()
    render(<YouTubePlayer video={video} />)
    await waitFor(() => expect(instances).toHaveLength(1))
    instances[0].config.events.onAutoplayBlocked()
    expect(await screen.findByText(/Playback needs a tap/)).toBeInTheDocument()
  })

  it.each(['UNAVAILABLE', 'EMBED_BLOCKED'])('does not mount an iframe for %s', availability => {
    const { container } = render(<YouTubePlayer video={{ ...video, availability }} />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('link', { name: 'View original on YouTube' })).toHaveAttribute('href', video.canonical_url)
  })

  it('does not create a player when a pending loader resolves after unmount', async () => {
    let resolve
    const Player = vi.fn()
    loadYouTube.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { unmount } = render(<YouTubePlayer video={video} />)
    unmount()
    resolve({ Player })
    await Promise.resolve()
    expect(Player).not.toHaveBeenCalled()
  })

  it('keeps only the newest source when navigation outruns the API loader', async () => {
    let resolve
    const pending = new Promise(done => { resolve = done })
    loadYouTube.mockReturnValue(pending)
    const Player = vi.fn(function () { return { destroy: vi.fn() } })
    const { container, rerender } = render(<YouTubePlayer video={video} />)
    rerender(<YouTubePlayer video={{ ...video, external_id: 'jNQXAC9IVRw' }} />)
    rerender(<YouTubePlayer video={{ ...video, external_id: 'abcdefghijk' }} />)
    await act(async () => resolve({ Player }))
    expect(Player).toHaveBeenCalledOnce()
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
    expect(container.querySelector('iframe').src).toContain('/abcdefghijk?')
  })

  it('recovers from player-service failure with a fresh iframe', async () => {
    loadYouTube.mockRejectedValueOnce(new Error('network'))
    const instances = provider()
    render(<YouTubePlayer video={video} />)
    expect(await screen.findByText(/The player could not load/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry player' }))
    await waitFor(() => expect(instances).toHaveLength(1))
    await act(async () => instances[0].config.events.onReady())
    expect(screen.getByText(/Tap the official play button/)).toBeInTheDocument()
  })
})

describe('Share and newest navigation', () => {
  it('keeps loading player feedback while detail is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    queryRender(<Watch slug={video.slug} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading player')
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
  })

  it('uses clipboard fallback and gives useful feedback', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<ShareActions video={video} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(await screen.findByText('App link copied.')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledOnce()
    expect(screen.getByRole('link', { name: 'Original link', hidden: true })).toHaveAttribute('href', video.canonical_url)
  })

  it('reports clipboard denial', async () => {
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    render(<ShareActions video={video} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy app link', hidden: true }))
    expect(await screen.findByText(/Could not copy/)).toBeInTheDocument()
  })

  it('shows boundaries and ignores arrows inside controls', async () => {
    const fetch = vi.fn(url => Promise.resolve({ ok: true, json: async () => url.includes('neighbors') ? { previous: null, next: null } : { ...video, availability: 'UNAVAILABLE' } }))
    vi.stubGlobal('fetch', fetch)
    queryRender(<Watch slug={video.slug} />)
    expect(await screen.findByText('Newest recipe')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveAccessibleDescription('Newest recipe')
    expect(screen.getByRole('button', { name: 'Next' })).toHaveAccessibleDescription('Oldest recipe')
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(fetch).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(await screen.findByText('No next recipe is available.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(3)
    input.remove()
  })

  it('focuses the first More action and restores the trigger on Escape', async () => {
    const { container } = render(<ShareActions video={video} />)
    const details = container.querySelector('details')
    details.open = true
    fireEvent(details, new window.Event('toggle'))
    expect(screen.getByRole('link', { name: 'Original link' })).toHaveFocus()
    fireEvent.keyDown(details, { key: 'Escape' })
    expect(details.open).toBe(false)
    expect(container.querySelector('summary')).toHaveFocus()
  })

  it('offers retry for detail/network and neighbor failures', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal('fetch', fetch)
    queryRender(<Watch slug={video.slug} />)
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    fetch.mockImplementation(url => Promise.resolve(url.includes('neighbors') ? { ok: false, status: 503 } : { ok: true, json: async () => ({ ...video, availability: 'UNAVAILABLE' }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Retry navigation' })).toBeInTheDocument()
  })

  it('removes player and server metadata when neighbor recheck finds a hidden current recipe', async () => {
    const content = document.createElement('section')
    content.id = 'recipe-details'
    document.body.append(content)
    let hidden = false
    vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(hidden ? { ok: false, status: url.includes('neighbors') ? 404 : 503 } : { ok: true, json: async () => url.includes('neighbors') ? { previous: null, next: { slug: 'older' } } : { ...video, availability: 'UNAVAILABLE' } })))
    queryRender(<Watch slug={video.slug} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())
    hidden = true
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Recipe no longer available')
    expect(screen.queryByRole('link', { name: 'View original on YouTube' })).not.toBeInTheDocument()
    expect(content.hidden).toBe(true)
    content.remove()
  })

  it('uses native share and does not report cancellation as failure', async () => {
    const share = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce({ name: 'AbortError' })
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: share })
    render(<ShareActions video={video} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(await screen.findByText('Share sheet opened.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/Could not copy/)).not.toBeInTheDocument()
  })
})
