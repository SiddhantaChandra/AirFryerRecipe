import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { catalog } from '../lib/api'

export function RecipeCard({ video }) {
  const [failedImage, setFailedImage] = useState(false)
  const tags = [...video.meal_types, ...video.cuisines].slice(0, 2)
  return <a className="recipe-card" href={`/shorts/${encodeURIComponent(video.slug)}`}>
    <div className="card-media">
      {video.thumbnail_url && !failedImage
        ? <img src={video.thumbnail_url} alt="" loading="lazy" width="360" height="640" onError={() => setFailedImage(true)} />
        : <span>Source image unavailable</span>}
    </div>
    <div className="card-copy">
      <h2>{video.recipe_name}</h2>
      <p className="source-label">{video.creator_name ? `${video.creator_name} · YouTube` : 'YouTube · Creator unavailable'}</p>
      <p className="card-meta"><span>{video.diet_label}</span><span>{video.cook_time_minutes ? `Cooking: ${video.cook_time_minutes} min` : 'Cooking time unknown'}</span></p>
      {tags.length > 0 && <p className="card-tags">{tags.map(tag => <span key={tag}>{tag}</span>)}</p>}
    </div>
  </a>
}

export function Discover() {
  const feed = useQuery({ queryKey: ['videos'], queryFn: ({ signal }) => catalog('', signal) })
  return <>
    <div className="discover-heading"><h1>Discover air fryer recipes</h1><p>Manually selected recipes. Watch the original, straight from the creator.</p></div>
    {feed.isPending ? <div aria-label="Loading recipes" aria-busy="true" className="recipe-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="recipe-skeleton"><div className="card-media" /><div className="skeleton-line" /></div>)}</div>
      : feed.isError ? <section role="alert" className="empty-state"><h2>Recipes could not load</h2><p>{feed.error.message}</p><button onClick={() => feed.refetch()}>Retry</button></section>
      : <>
        <p className="result-count" role="status">Newest first · Showing {feed.data.results.length} of {feed.data.count} recipes</p>
        {feed.data.results.length ? <div className="recipe-grid">{feed.data.results.map(video => <RecipeCard key={video.id} video={video} />)}</div>
          : <section className="empty-state"><h2>The archive is getting started</h2><p>Published recipes will appear here after manual review.</p><button onClick={() => feed.refetch()}>Check again</button></section>}
        {feed.data.results.length > 0 && <p className="feed-end">{feed.data.count > feed.data.results.length ? 'These are the latest recipes in the archive.' : 'You’ve reached the end of the archive.'}</p>}
        {feed.data.diet_policy && <details className="diet-policy"><summary>How dietary labels are reviewed</summary><p>{feed.data.diet_policy}</p></details>}
      </>}
  </>
}
