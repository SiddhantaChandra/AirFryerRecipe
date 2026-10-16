let pending

export function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (pending) return pending
  pending = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    const script = document.createElement('script')
    let timer
    function restore() {
      clearTimeout(timer)
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous
    }
    function fail() {
      restore()
      script.remove()
      pending = undefined
      reject(new Error('The player service could not load.'))
    }
    function ready() {
      restore()
      try { previous?.() } finally { resolve(window.YT) }
    }
    window.onYouTubeIframeAPIReady = ready
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = fail
    timer = setTimeout(fail, 15000)
    document.head.append(script)
  })
  return pending
}

export function playerFailure(code) {
  if (code === 153) return { message: 'Player identity/configuration failure (153). Origin or Referer needs checking; this does not mean the video was removed.', retry: true }
  if ([101, 150].includes(code)) return { message: 'The creator does not allow embedding. View the original on YouTube.', retry: false }
  if (code === 100) return { message: 'The source is unavailable. It may be private or removed.', retry: false }
  return { message: 'The player could not load. Retry or view the original on YouTube.', retry: true }
}
