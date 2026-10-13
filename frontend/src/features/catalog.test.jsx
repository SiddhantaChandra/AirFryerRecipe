import { StrictMode } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
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
  it('reserves loading geometry, then renders empty state and no future controls', async () => {
    let resolve
    vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done })))
    queryRender(<Discover />)
    expect(screen.getByLabelText('Loading recipes')).toBeInTheDocument()
    resolve({ ok: true, json: async () => ({ results: [], count: 0 }) })
    expect(await screen.findByRole('heading', { name: 'The archive is getting started' })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Load more')).not.toBeInTheDocument()
  })

  it('shows retry after failure and recovers to published cards', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, json: async () => ({ results: [video], count: 1 }) })
    vi.stubGlobal('fetch', fetch)
    queryRender(<Discover />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Recipes could not load')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
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
})

describe('Share and newest navigation', () => {
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
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(fetch).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(await screen.findByText('No next recipe is available.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(3)
    input.remove()
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
