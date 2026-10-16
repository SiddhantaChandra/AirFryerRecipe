import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { catalog, publicRequest } from '../lib/api'
import { emptyQuery, facets, queryString, readRecord, rememberOrigin, useDiscoveryLocation, watchURL, writeRecord } from '../lib/discovery'
import { DebouncedSearch } from '../components/DebouncedSearch'
import { FilterDrawer, FilterPanel } from './Filters'

export function RecipeCard({ video, query = emptyQuery(), onOpen }) {
  const [failedImage, setFailedImage] = useState(false)
  const tags = [...video.meal_types, ...video.cuisines].slice(0, 2)
  return <a className="recipe-card" data-recipe-slug={video.slug} href={watchURL(video.slug, query)} onClick={onOpen} onAuxClick={onOpen}>
    <div className="card-media">
      {video.thumbnail_url && !failedImage
        ? <img src={video.thumbnail_url} alt="" loading="lazy" width="360" height="640" onError={() => setFailedImage(true)} />
        : <span>Source image unavailable</span>}
    </div>
    <div className="card-copy">
      <h2 title={video.recipe_name}>{video.recipe_name}</h2>
      <p className="source-label">{video.creator_name ? `${video.creator_name} · YouTube` : 'YouTube · Creator unavailable'}</p>
      <p className="card-meta"><span>{video.diet_label}</span><span>{video.cook_time_minutes ? `Cooking: ${video.cook_time_minutes} min` : 'Cooking time unknown'}</span></p>
      {tags.length > 0 && <p className="card-tags">{tags.map(tag => <span key={tag}>{tag}</span>)}</p>}
    </div>
  </a>
}

export function RecipeSearch() {
  const { query, commit } = useDiscoveryLocation()
  return <DebouncedSearch label="Search recipes" value={query.q} onSubmit={value => commit({ ...query, q: value }, true)} />
}

export function Discover({ showSearch = true }) {
  const { query, entry, commit } = useDiscoveryLocation()
  const semantic = queryString(query)
  const [drawer, setDrawer] = useState(false)
  const [desktop, setDesktop] = useState(() => window.innerWidth >= 1024)
  const [announcement, setAnnouncement] = useState('')
  const queryClient = useQueryClient()
  const displayFilters = useQuery({ queryKey: ['filter-counts', semantic], queryFn: ({ signal }) => publicRequest(`/api/v1/filters/?${semantic}`, signal) })
  const resultsHeading = useRef(null)
  const record = useRef(null)
  const restored = useRef(false)
  const currentEntry = useRef('')
  if (currentEntry.current !== entry + semantic) {
    currentEntry.current = entry + semantic
    const saved = readRecord(`archive-entry-${entry}`)
    record.current = saved?.query === semantic && (saved.card || saved.scroll > 0 || saved.depth > 1) ? saved : null
    restored.current = false
  }
  const feed = useInfiniteQuery({ queryKey: ['videos', semantic, entry], initialPageParam: null,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams(semantic)
      if (pageParam) params.set('cursor', pageParam)
      return catalog(params.size ? `?${params}` : '', signal)
    }, getNextPageParam: page => page.next_cursor || undefined, refetchOnMount: 'always',
  })
  const pages = feed.data?.pages || []
  const videos = [...new Map(pages.flatMap(page => page.results).map(video => [video.id, video])).values()]
  const data = pages[0]
  const restoring = !restored.current && !!record.current && !feed.isError && (feed.isPending || feed.isFetching || pages.length < record.current.depth && feed.hasNextPage)
  const latest = useRef(null)
  latest.current = { pages, entry, semantic }
  function save(slug) {
    const current = latest.current
    const previous = readRecord(`archive-entry-${current.entry}`)
    writeRecord(`archive-entry-${current.entry}`, { query: current.semantic, depth: Math.max(1, current.pages.length), cursors: current.pages.map(page => page.next_cursor), scroll: window.scrollY, card: slug || previous?.card || null })
  }
  const saving = useRef(save)
  saving.current = save
  useEffect(() => {
    const before = history.scrollRestoration
    history.scrollRestoration = 'manual'
    const resize = () => { setDesktop(window.innerWidth >= 1024); if (window.innerWidth >= 1024) setDrawer(false) }
    const persist = () => { if (restored.current) saving.current() }
    const revalidate = event => {
      if (event.persisted) {
        record.current = readRecord(`archive-entry-${latest.current.entry}`)
        restored.current = false
      }
      queryClient.invalidateQueries({ queryKey: ['videos'] }); queryClient.invalidateQueries({ queryKey: ['filter-counts'] }); queryClient.invalidateQueries({ queryKey: ['ingredient-options'] })
    }
    window.addEventListener('resize', resize)
    window.addEventListener('pagehide', persist)
    window.addEventListener('scroll', persist, { passive: true })
    window.addEventListener('pageshow', revalidate)
    return () => {
      history.scrollRestoration = before
      window.removeEventListener('resize', resize); window.removeEventListener('pagehide', persist)
      window.removeEventListener('scroll', persist); window.removeEventListener('pageshow', revalidate)
    }
  }, [queryClient])
  useEffect(() => {
    if (!data || feed.isFetching || feed.isError || restored.current) return
    if (record.current && pages.length < record.current.depth && feed.hasNextPage) {
      feed.fetchNextPage({ cancelRefetch: false }); return
    }
    restored.current = true
    if (record.current) {
      const saved = record.current
      requestAnimationFrame(() => {
        window.scrollTo(0, saved.scroll || 0)
        const card = [...document.querySelectorAll('[data-recipe-slug]')].find(node => node.dataset.recipeSlug === saved.card)
        ;(card || resultsHeading.current)?.focus({ preventScroll: true })
      })
    }
  }, [data, feed, pages.length])
  useEffect(() => {
    if (data?.query && queryString(data.query) !== semantic) commit(data.query, true)
  }, [data, semantic, commit])
  const selected = facets.flatMap(key => query[key].map(value => ({ key, value })))
  const isFiltered = !!(query.q || query.max_time || selected.length)
  const label = (key, value) => {
    const filters = displayFilters.data
    return [...(filters?.[key] || []), ...(key === 'ingredient' ? filters?.selected_ingredients || [] : [])].find(option => option.value === value)?.label || ({ VEG: 'Vegetarian', VEGAN: 'Vegan', NON_VEG: 'Non-vegetarian', UNKNOWN: 'Unknown', easy: 'Easy', medium: 'Medium', hard: 'Hard' }[value]) || value
  }
  return <>
    {showSearch && <RecipeSearch />}
    <div className="discover-heading"><h1>Discover air fryer recipes</h1><p>Manually selected recipes. Watch the original, straight from the creator.</p></div>
    <div className="discovery-layout">
      {desktop && <aside className="filter-sidebar" aria-label="Recipe filters"><FilterPanel query={query} onChange={commit} /></aside>}
      <section className="discovery-results" aria-label="Recipe results" aria-busy={feed.isFetching || restoring}>
        <div className="results-toolbar"><h2 ref={resultsHeading} tabIndex={-1}>Recipes</h2>{!desktop && <button onClick={() => setDrawer(true)}>Filters{selected.length ? ` (${selected.length + (query.max_time ? 1 : 0)})` : ''}</button>}</div>
        <div className="active-filters" aria-label="Active filters">
          {query.q && <button onClick={() => commit({ ...query, q: '' })}>Search: {query.q} ×<span className="sr-only">Remove search</span></button>}
          {selected.map(({ key, value }) => <button key={`${key}-${value}`} onClick={() => commit({ ...query, [key]: query[key].filter(item => item !== value) })}>{label(key, value)} ×<span className="sr-only">Remove {key.replace('_', ' ')}</span></button>)}
          {query.max_time && <button onClick={() => commit({ ...query, max_time: null })}>≤ {query.max_time} min ×<span className="sr-only">Remove maximum cooking time</span></button>}
          {isFiltered && <button onClick={() => commit(emptyQuery())}>Clear all</button>}
        </div>
        {feed.isPending ? <div aria-label="Loading recipes" className="recipe-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="recipe-skeleton"><div className="card-media" /><div className="skeleton-line" /></div>)}</div>
          : feed.isError && !data ? <section role="alert" className="empty-state"><h2>Recipes could not load</h2><p>{feed.error.message}</p><button onClick={() => feed.refetch()}>Retry recipes</button></section>
            : <>
              <p className="result-count" role="status">Newest first · Showing {videos.length} of {data?.count ?? 0} recipes{feed.isFetching && !feed.isFetchingNextPage ? ' · Refreshing results…' : ''}{restoring ? ' · Restoring results…' : ''}</p>
              {feed.isRefetchError && <p role="alert">Results could not refresh. The displayed recipes may have changed. <button onClick={() => feed.refetch()}>Retry recipes</button></p>}
              {videos.length ? <div className="recipe-grid">{videos.map(video => <RecipeCard key={video.id} video={video} query={query} onOpen={event => rememberOrigin(event, video.slug, query, save)} />)}</div>
                : <section className="empty-state"><h2>{isFiltered ? 'No recipes match' : 'The archive is getting started'}</h2><p>{isFiltered ? 'Try removing a filter or changing your search.' : 'Published recipes will appear here after manual review.'}</p><button onClick={() => isFiltered ? commit(emptyQuery()) : feed.refetch()}>{isFiltered ? 'Clear all filters' : 'Check again'}</button></section>}
              {feed.isFetchNextPageError && <p role="alert">More recipes could not load. Your loaded recipes are still here.</p>}
              {(feed.hasNextPage || feed.isFetchNextPageError) && <div className="load-more"><button aria-disabled={feed.isFetching || restoring} onClick={async () => {
                if (feed.isFetching || restoring) return
                const before = videos.length
                const result = await feed.fetchNextPage({ cancelRefetch: false })
                if (!result.isError) setAnnouncement(`${Math.max(0, new Set(result.data.pages.flatMap(page => page.results.map(video => video.id))).size - before)} recipes added.`)
              }}>{feed.isFetchingNextPage ? 'Loading recipes…' : feed.isFetchNextPageError ? 'Retry more recipes' : 'Load more'}</button></div>}
              {!!videos.length && !feed.hasNextPage && !feed.isFetchNextPageError && <p className="feed-end">You’ve reached the end of the results.</p>}
              {data?.diet_policy && <details className="diet-policy"><summary>How dietary labels are reviewed</summary><p>{data.diet_policy}</p></details>}
            </>}
        <p className="sr-only" role="status">{announcement}</p>
      </section>
    </div>
    {drawer && <FilterDrawer query={query} onApply={commit} onClose={() => setDrawer(false)} />}
  </>
}
