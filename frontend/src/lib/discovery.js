import { useCallback, useEffect, useState } from 'react'

export const facets = ['diet', 'ingredient', 'cuisine', 'meal_type', 'difficulty', 'language']
export const emptyQuery = () => ({ q: '', sort: 'newest', max_time: null, ...Object.fromEntries(facets.map(key => [key, []])) })

export function parseQuery(search) {
  const params = new URLSearchParams(search)
  return { q: (params.get('q') || '').trim().replace(/\s+/g, ' '), sort: params.get('sort') || 'newest',
    max_time: params.get('max_time') || null, ...Object.fromEntries(facets.map(key => [key, [...new Set(params.getAll(key))].sort()])) }
}

export function queryString(query) {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q.trim().replace(/\s+/g, ' '))
  for (const key of facets) [...new Set(query[key] || [])].sort().forEach(value => params.append(key, value))
  if (query.max_time) params.set('max_time', query.max_time)
  if (query.sort && query.sort !== 'newest') params.set('sort', query.sort)
  return params.toString()
}

export const discoverURL = query => queryString(query) ? `/?${queryString(query)}` : '/'
export const watchURL = (slug, query) => `/shorts/${encodeURIComponent(slug)}${queryString(query) ? `?${queryString(query)}` : ''}`

export function readRecord(key) {
  try { return JSON.parse(sessionStorage.getItem(key)) } catch { return null }
}
export function writeRecord(key, record) {
  try { sessionStorage.setItem(key, JSON.stringify(record)) } catch { /* URLs work without tab-local storage. */ }
}
export function entryKey() {
  if (!history.state?.archiveEntry) history.replaceState({ ...history.state, archiveEntry: crypto.randomUUID() }, '', window.location.href)
  return history.state.archiveEntry
}

export function useDiscoveryLocation() {
  const [location, setLocation] = useState(() => ({ query: parseQuery(window.location.search), entry: entryKey() }))
  useEffect(() => {
    const update = () => setLocation({ query: parseQuery(window.location.search), entry: entryKey() })
    window.addEventListener('popstate', update)
    window.addEventListener('archive-query', update)
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('archive-query', update) }
  }, [])
  const commit = useCallback((query, replace = false) => {
    const next = queryString(query)
    if (next === queryString(parseQuery(window.location.search))) return
    const state = { ...history.state, archiveEntry: replace ? entryKey() : crypto.randomUUID() }
    history[replace ? 'replaceState' : 'pushState'](state, '', next ? `/?${next}` : '/')
    writeRecord(`archive-entry-${state.archiveEntry}`, { query: next, depth: 1, cursors: [], scroll: 0 })
    window.dispatchEvent(new Event('archive-query'))
  }, [])
  return { ...location, commit }
}

// A normal same-tab link records the originating entry; modified/new-tab links
// use their complete semantic URL and do not depend on restoration metadata.
export function rememberOrigin(event, slug, query, save) {
  save(slug)
  if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    writeRecord('archive-watch-pending', { target: watchURL(slug, query), url: discoverURL(query), entry: entryKey(), steps: 1 })
  }
}

export function watchOrigin() {
  const pending = readRecord('archive-watch-pending')
  try { sessionStorage.removeItem('archive-watch-pending') } catch { /* Optional storage. */ }
  if (pending?.target === `${window.location.pathname}${window.location.search}`) {
    history.replaceState({ ...history.state, archiveOrigin: pending }, '', window.location.href)
  }
  return history.state?.archiveOrigin || null
}
