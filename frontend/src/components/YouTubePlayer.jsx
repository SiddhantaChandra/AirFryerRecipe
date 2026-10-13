import { useEffect, useRef, useState } from 'react'
import { loadYouTube, playerFailure } from '../lib/youtube'

export function YouTubePlayer({ video }) {
  const container = useRef(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ message: 'Loading the official player…', retry: false })
  const blocked = ['EMBED_BLOCKED', 'UNAVAILABLE'].includes(video.availability)
  useEffect(() => {
    if (blocked) return
    let disposed = false
    let player
    const timer = setTimeout(() => {
      if (!disposed) setState({ message: 'The player has not responded. Retry or view the original.', retry: true })
    }, 20000)
    const host = container.current
    const iframe = document.createElement('iframe')
    iframe.title = 'Official YouTube recipe player'
    iframe.referrerPolicy = 'strict-origin-when-cross-origin'
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
    const params = new window.URLSearchParams({ enablejsapi: '1', playsinline: '1', origin: window.location.origin })
    iframe.src = `https://www.youtube-nocookie.com/embed/${video.external_id}?${params}`
    host.replaceChildren(iframe)
    loadYouTube().then(YT => {
      if (disposed) return
      player = new YT.Player(iframe, { events: {
        onReady: () => { if (!disposed) { clearTimeout(timer); setState({ message: 'Ready. Tap the official play button.', retry: false }) } },
        onStateChange: event => { if (!disposed && event.data === 1) { clearTimeout(timer); setState({ message: 'Playing the original source.', retry: false }) } },
        onError: event => { if (!disposed) { clearTimeout(timer); setState(playerFailure(event.data)) } },
        onAutoplayBlocked: () => { if (!disposed) setState({ message: 'Playback needs a tap. Use the official play button.', retry: false }) },
      } })
    }).catch(() => { if (!disposed) { clearTimeout(timer); setState(playerFailure(0)) } })
    const pause = () => { if (document.hidden) player?.pauseVideo?.() }
    document.addEventListener('visibilitychange', pause)
    return () => {
      disposed = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', pause)
      player?.destroy()
      host.replaceChildren()
    }
  }, [video.external_id, blocked, attempt])
  if (blocked) return <div className="player-fallback" role="status"><p>{video.availability === 'EMBED_BLOCKED' ? 'Embedding is disabled by the creator.' : 'The source may be private or removed.'}</p><a href={video.canonical_url}>View original on YouTube</a></div>
  return <div className="player-column">
    <div className="portrait-player" ref={container} />
    <p role="status" aria-live="polite">{state.message}</p>
    {state.retry && <button onClick={() => { setState({ message: 'Loading the official player…', retry: false }); setAttempt(value => value + 1) }}>Retry player</button>}
    <a href={video.canonical_url}>View original on YouTube</a>
  </div>
}
