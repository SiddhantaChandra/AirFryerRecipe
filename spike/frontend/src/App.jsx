import { useState } from 'react'

const TEST_PRESETS = [
  {
    label: '1. Real Public Short (Air Fryer Okra)',
    url: 'https://www.youtube.com/shorts/uLIOVZNFlPE',
    description: 'Crispy Kurkure Bhindi Air Fryer recipe short',
  },
  {
    label: '2. Standard Video (16:9)',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    description: 'First YouTube video (public standard 16:9)',
  },
  {
    label: '3. Private / Deleted Video',
    url: 'https://www.youtube.com/watch?v=00000000000',
    description: 'Non-existent or private video ID',
  },
  {
    label: '4. Embed Disabled (Simulated/Restricted)',
    url: 'https://www.youtube.com/watch?v=m8e-FF8MsqU',
    description: 'Restricted embed test link',
  },
]

export default function App() {
  const [url, setUrl] = useState(TEST_PRESETS[0].url)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [embedHost, setEmbedHost] = useState('www.youtube.com') // 'www.youtube.com' or 'www.youtube-nocookie.com'
  const [thumbnailFit, setThumbnailFit] = useState('contain') // 'contain' vs 'cover'

  const handlePreview = async (targetUrl = url) => {
    if (!targetUrl.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/preview/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl.trim() }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }
      setResult(data)
    } catch (err) {
      setError(err.message || 'Failed to fetch preview')
    } finally {
      setLoading(false)
    }
  }

  const formatDuration = (seconds) => {
    if (seconds == null) return 'Unknown'
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  return (
    <div style={{ maxWidth: '1040px', margin: '0 auto', padding: '24px 16px' }}>
      <header style={{ marginBottom: '28px', borderBottom: '1px solid var(--color-border)', paddingBottom: '16px' }}>
        <div style={{ display: 'inline-block', backgroundColor: 'var(--color-surface)', padding: '4px 10px', borderRadius: '999px', fontSize: '13px', color: 'var(--color-accent)', fontWeight: 600, marginBottom: '8px' }}>
          Phase 0 Feasibility Spike
        </div>
        <h1 style={{ fontSize: '26px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '6px' }}>
          YouTube Shorts Ingestion & Embed Spike
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '15px' }}>
          Validates URL normalization, server-side YouTube Data API v3 metadata retrieval, official iframe embed behavior, and thumbnail geometry.
        </p>
      </header>

      {/* Input Form & Presets */}
      <section style={{ backgroundColor: 'var(--color-surface)', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '17px', fontWeight: 600, marginBottom: '12px' }}>Input YouTube URL</h2>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste YouTube Short or Watch URL..."
            style={{
              flex: '1 1 320px',
              padding: '10px 14px',
              borderRadius: '10px',
              border: '1px solid var(--color-border-strong)',
              fontSize: '15px',
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handlePreview()
            }}
          />
          <button
            onClick={() => handlePreview()}
            disabled={loading}
            style={{
              padding: '10px 22px',
              borderRadius: '10px',
              backgroundColor: 'var(--color-accent)',
              color: 'var(--color-on-accent)',
              border: 'none',
              fontWeight: 600,
              fontSize: '15px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Fetching...' : 'Preview URL'}
          </button>
        </div>

        {/* Presets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontWeight: 500 }}>
            Test Links (TASKLIST-0 §A1):
          </span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {TEST_PRESETS.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setUrl(preset.url)
                  handlePreview(preset.url)
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Error Feedback */}
      {error && (
        <div
          style={{
            backgroundColor: 'var(--color-danger-surface)',
            color: 'var(--color-danger)',
            padding: '14px 18px',
            borderRadius: '10px',
            border: '1px solid var(--color-danger)',
            marginBottom: '24px',
            fontSize: '14px',
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Not Found / Unavailable Status */}
      {result && result.found === false && (
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            padding: '24px',
            borderRadius: '12px',
            border: '1px solid var(--color-border)',
            marginBottom: '24px',
          }}
        >
          <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-danger)' }}>
            Video Unavailable or Private
          </h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '12px' }}>
            Video ID <code>{result.video_id}</code> was not returned by the YouTube Data API.
          </p>
          <div style={{ fontSize: '14px' }}>
            Reason: <strong>{result.reason}</strong>
          </div>
        </div>
      )}

      {/* Successful Metadata Result */}
      {result && result.found && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px', alignItems: 'start' }}>
          
          {/* Column 1: Embed Player */}
          <div style={{ backgroundColor: 'var(--color-surface)', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Official Player Embed</h3>
              <div style={{ fontSize: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <span>Host:</span>
                  <select
                    value={embedHost}
                    onChange={(e) => setEmbedHost(e.target.value)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      fontSize: '12px',
                    }}
                  >
                    <option value="www.youtube.com">youtube.com</option>
                    <option value="www.youtube-nocookie.com">youtube-nocookie.com (Privacy-Enhanced)</option>
                  </select>
                </label>
              </div>
            </div>

            {result.embeddable === false ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', backgroundColor: 'var(--color-bg)', borderRadius: '10px', border: '1px dashed var(--color-border-strong)' }}>
                <p style={{ color: 'var(--color-danger)', fontWeight: 600, marginBottom: '8px' }}>
                  Embedding is disabled by the creator for this video.
                </p>
                <a
                  href={`https://www.youtube.com/watch?v=${result.video_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--color-accent)', textDecoration: 'underline', fontSize: '14px' }}
                >
                  View on YouTube directly
                </a>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                {/* Portrait player frame matching DESIGNS.md §3.3 & §6.2 */}
                <div
                  style={{
                    width: '100%',
                    maxWidth: '340px',
                    aspectRatio: '9 / 16',
                    backgroundColor: '#000000',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  <iframe
                    title={result.title}
                    src={`https://${embedHost}/embed/${result.video_id}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&rel=0`}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                    }}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              </div>
            )}

            {/* Attribution per YouTube Terms and DESIGNS.md §2 */}
            <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--color-border)', fontSize: '13px' }}>
              <div style={{ color: 'var(--color-text-muted)' }}>
                Channel: <strong style={{ color: 'var(--color-text)' }}>{result.channel_title}</strong>
              </div>
              <div style={{ marginTop: '4px' }}>
                <a
                  href={`https://www.youtube.com/watch?v=${result.video_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}
                >
                  Watch original on YouTube &rarr;
                </a>
              </div>
            </div>
          </div>

          {/* Column 2: Metadata & Thumbnail Inspector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Metadata Card */}
            <div style={{ backgroundColor: 'var(--color-surface)', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '14px' }}>Retrieved API Metadata</h3>
              <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 0', color: 'var(--color-text-muted)', width: '120px' }}>Title</td>
                    <td style={{ padding: '8px 0', fontWeight: 600 }}>{result.title}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 0', color: 'var(--color-text-muted)' }}>Channel</td>
                    <td style={{ padding: '8px 0' }}>{result.channel_title}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 0', color: 'var(--color-text-muted)' }}>Duration</td>
                    <td style={{ padding: '8px 0' }}>
                      {formatDuration(result.duration_seconds)} ({result.duration_iso || 'N/A'})
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 0', color: 'var(--color-text-muted)' }}>Published At</td>
                    <td style={{ padding: '8px 0' }}>{result.published_at ? new Date(result.published_at).toLocaleString() : 'N/A'}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 0', color: 'var(--color-text-muted)' }}>Embeddable</td>
                    <td style={{ padding: '8px 0' }}>
                      <span style={{ color: result.embeddable ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600 }}>
                        {result.embeddable ? 'Allowed' : 'Blocked / Disabled'}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 0', color: 'var(--color-text-muted)' }}>Privacy</td>
                    <td style={{ padding: '8px 0', textTransform: 'capitalize' }}>{result.privacy_status}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Thumbnail Geometry & Letterboxing Inspector (TASKLIST-0 §A4 & DESIGNS §6.1) */}
            <div style={{ backgroundColor: 'var(--color-surface)', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Thumbnail Geometry & Letterbox Test</h3>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setThumbnailFit('contain')}
                    style={{
                      padding: '4px 8px',
                      fontSize: '12px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: thumbnailFit === 'contain' ? 'var(--color-accent)' : 'var(--color-bg)',
                      color: thumbnailFit === 'contain' ? 'var(--color-on-accent)' : 'var(--color-text)',
                      cursor: 'pointer',
                    }}
                  >
                    object-fit: contain
                  </button>
                  <button
                    type="button"
                    onClick={() => setThumbnailFit('cover')}
                    style={{
                      padding: '4px 8px',
                      fontSize: '12px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: thumbnailFit === 'cover' ? 'var(--color-accent)' : 'var(--color-bg)',
                      color: thumbnailFit === 'cover' ? 'var(--color-on-accent)' : 'var(--color-text)',
                      cursor: 'pointer',
                    }}
                  >
                    object-fit: cover
                  </button>
                </div>
              </div>

              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '14px' }}>
                YouTube API delivers horizontal (16:9 / 4:3) thumbnail assets even for vertical Shorts. Below tests how they render inside a provisional 9:16 portrait recipe card footprint.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '14px' }}>
                {Object.entries(result.thumbnails || {}).map(([key, thumb]) => (
                  <div key={key} style={{ backgroundColor: 'var(--color-bg)', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px', textTransform: 'capitalize' }}>
                      {key} ({thumb.width}x{thumb.height})
                    </div>
                    {/* 9:16 portrait test frame */}
                    <div
                      style={{
                        width: '100%',
                        aspectRatio: '9 / 16',
                        backgroundColor: '#1E1E1E',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <img
                        src={thumb.url}
                        alt={`${key} thumbnail preview`}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: thumbnailFit,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
