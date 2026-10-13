(() => {
  const frame = document.getElementById('source-player');
  if (!frame) return;
  const status = document.getElementById('source-player-status');
  const retry = document.getElementById('source-player-retry');
  let player;
  let script;
  let timer;
  let disposed = false;
  const previousReady = window.onYouTubeIframeAPIReady;

  function show(message, recoverable = false) {
    if (disposed) return;
    status.textContent = message;
    retry.hidden = !recoverable;
  }

  function initialize() {
    if (disposed || player || !window.YT?.Player) return;
    player = new window.YT.Player(frame, {
      events: {
        onReady() {
          clearTimeout(timer);
          show('Ready. Use the official player controls to play.');
        },
        onStateChange(event) {
          if (event.data === 1) {
            clearTimeout(timer);
            show('Playing the original YouTube source.');
          }
        },
        onAutoplayBlocked() {
          show('Playback needs a tap. Use the official play button.');
        },
        onError(event) {
          clearTimeout(timer);
          if (event.data === 153) {
            show('Player identity/configuration failure (153). Check origin and Referer; this does not mean the source was removed.', true);
          } else if ([101, 150].includes(event.data)) {
            show('The creator does not allow embedding. Use View original on YouTube.');
          } else if (event.data === 100) {
            show('The source is unavailable: it may be private or removed. Check View original on YouTube.');
          } else {
            show('The player could not load. Retry or use View original on YouTube.', true);
          }
        },
      },
    });
  }

  function load() {
    show('Loading the official player…');
    timer = setTimeout(() => {
      show('The player has not responded. Retry or use View original on YouTube.', true);
    }, 15000);
    if (window.YT?.Player) {
      initialize();
      return;
    }
    script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      clearTimeout(timer);
      show('The player service could not load. Retry or use View original on YouTube.', true);
    };
    document.head.append(script);
  }

  function ready() {
    previousReady?.();
    initialize();
  }
  window.onYouTubeIframeAPIReady = ready;
  retry.addEventListener('click', () => window.location.reload());
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearTimeout(timer);
    player?.destroy();
    script?.remove();
    if (window.onYouTubeIframeAPIReady === ready) {
      window.onYouTubeIframeAPIReady = previousReady;
    }
  }, { once: true });
  // A page restored from the back/forward cache needs a fresh player after cleanup.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
  });
  load();
})();
