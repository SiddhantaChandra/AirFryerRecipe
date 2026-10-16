import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DebouncedSearch } from '../components/DebouncedSearch'
import { Discover } from './Discover'
import { FilterDrawer, FilterPanel } from './Filters'
import { ShareActions, Watch } from './Watch'
import { emptyQuery, parseQuery, queryString, watchURL, writeRecord } from '../lib/discovery'

const video = { id: 'one', slug: 'potato', recipe_name: 'Crispy potatoes', diet_label: 'Vegetarian',
  cook_time_minutes: 20, meal_types: [], cuisines: [], availability: 'UNAVAILABLE', canonical_url: 'https://www.youtube.com/watch?v=abcdefghijk' }
const filters = { count: 1, diet: [{ value: 'VEG', label: 'Vegetarian', count: 1 }, { value: 'VEGAN', label: 'Vegan', count: 0 }],
  ingredient: [{ value: 'potato', label: 'Potato', count: 1 }], selected_ingredients: [], cuisine: [], meal_type: [], language: [],
  difficulty: [{ value: 'easy', label: 'Easy', count: 1 }], max_time: [{ value: 20, label: '20 minutes or less', count: 1 }] }
const response = data => ({ ok: true, json: async () => data })
function queryRender(element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}
beforeEach(() => {
  window.history.replaceState({}, '', '/')
  sessionStorage.clear()
  window.innerWidth = 1280
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(window.HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function () { this.open = true } })
  Object.defineProperty(window.HTMLDialogElement.prototype, 'close', { configurable: true, value: function () { this.open = false } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('normalizes repeated URL state and excludes option/page cursors from watch links', () => {
  const query = parseQuery('?ingredient=potato&ingredient=potato&q=crispy++potato&diet=VEG&cursor=x&ingredient_q=aloo')
  expect(queryString(query)).toBe('q=crispy+potato&diet=VEG&ingredient=potato')
  expect(watchURL('आलू', query)).toContain('/shorts/%E0%A4%86%E0%A4%B2%E0%A5%82?q=')
})

it('debounces both searches, cancels old typing, and submits Enter immediately', async () => {
  vi.useFakeTimers()
  const submit = vi.fn()
  render(<DebouncedSearch label="Search recipes" value="" onSubmit={submit} />)
  const input = screen.getByRole('searchbox')
  fireEvent.change(input, { target: { value: 'old' } })
  await act(() => vi.advanceTimersByTimeAsync(200))
  fireEvent.change(input, { target: { value: 'potato' } })
  await act(() => vi.advanceTimersByTimeAsync(299))
  expect(submit).not.toHaveBeenCalled()
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(submit).toHaveBeenLastCalledWith('potato')
  fireEvent.change(input, { target: { value: 'instant' } })
  fireEvent.submit(input.closest('form'))
  expect(submit).toHaveBeenLastCalledWith('instant')
})

it('does not submit incomplete composition and debounces the completed script', async () => {
  vi.useFakeTimers()
  const submit = vi.fn()
  render(<DebouncedSearch label="Search ingredients" value="" onSubmit={submit} />)
  const input = screen.getByRole('searchbox')
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: 'आलू' } })
  fireEvent.submit(input.closest('form'))
  await act(() => vi.advanceTimersByTimeAsync(500))
  expect(submit).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input)
  await act(() => vi.advanceTimersByTimeAsync(300))
  expect(submit).toHaveBeenCalledWith('आलू')
  fireEvent.click(screen.getByRole('button', { name: 'Clear search ingredients' }))
  expect(submit).toHaveBeenLastCalledWith('')
})

it('disables zero-count unselected choices and keeps selected choices removable', async () => {
  const change = vi.fn()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(filters)))
  queryRender(<FilterPanel query={{ ...emptyQuery(), diet: ['VEGAN'] }} onChange={change} />)
  const selected = await screen.findByRole('checkbox', { name: /Vegan/ })
  expect(selected).toBeEnabled()
  fireEvent.click(selected)
  expect(change.mock.calls[0][0].diet).toEqual([])
})

it('retains selected ingredients outside searched pages and loads more choices', async () => {
  vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(response(url.includes('ingredient_cursor')
    ? { ...filters, ingredient: [{ value: 'salt', label: 'Salt', count: 1 }] }
    : { ...filters, ingredient: [], selected_ingredients: [{ value: 'potato', label: 'Potato', count: 0 }], ingredient_next_cursor: 'next' }))))
  queryRender(<FilterPanel query={{ ...emptyQuery(), ingredient: ['potato'] }} onChange={vi.fn()} />)
  expect(await screen.findByRole('checkbox', { name: /Potato/ })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Load more ingredients' }))
  expect(await screen.findByRole('checkbox', { name: /Salt/ })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: /Potato/ })).toBeEnabled()
})

it('validates custom cooking time and submits grouped difficulty', async () => {
  const change = vi.fn()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(filters)))
  queryRender(<FilterPanel query={emptyQuery()} onChange={change} />)
  fireEvent.change(screen.getByLabelText('Custom minutes or less'), { target: { value: '2.5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Set' }))
  expect(screen.getByRole('alert')).toHaveTextContent('positive whole')
  fireEvent.change(screen.getByLabelText('Custom minutes or less'), { target: { value: '17' } })
  fireEvent.click(screen.getByRole('button', { name: 'Set' }))
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ max_time: 17 }))
  fireEvent.click(await screen.findByRole('checkbox', { name: /Easy/ }))
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ difficulty: ['easy'] }))
})

it('keeps drawer draft state separate until Apply, and cancels safely', async () => {
  const apply = vi.fn(), close = vi.fn()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(filters)))
  const { unmount } = queryRender(<FilterDrawer query={emptyQuery()} onApply={apply} onClose={close} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: /Vegetarian/ }))
  expect(apply).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Vegetarian/ })).toBeChecked())
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ diet: ['VEG'] }))
  expect(close).toHaveBeenCalledOnce()
  unmount()
  expect(document.body.style.overflow).toBe('')
})

it('creates URL entries for filters, resets pagination, and replaces recipe typing', async () => {
  vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(response(url.includes('/filters/') ? filters : { count: 1, results: [video] }))))
  queryRender(<Discover />)
  const push = vi.spyOn(window.history, 'pushState'), replace = vi.spyOn(window.history, 'replaceState')
  fireEvent.click(await screen.findByRole('checkbox', { name: /Vegetarian/ }))
  expect(window.location.search).toBe('?diet=VEG')
  expect(push).toHaveBeenCalledOnce()
  const input = screen.getByRole('searchbox', { name: 'Search recipes' })
  fireEvent.change(input, { target: { value: 'potato' } })
  fireEvent.submit(input.closest('form'))
  expect(replace).toHaveBeenCalled()
  expect(window.location.search).toBe('?q=potato&diet=VEG')
  await waitFor(() => expect(screen.getByRole('link', { name: /Crispy potatoes/ })).toHaveAttribute('href', '/shorts/potato?q=potato&diet=VEG'))
  fireEvent.click(screen.getByRole('button', { name: 'Clear all', exact: true }))
  expect(window.location.search).toBe('')
})

it('keeps pages on append failure, retries, deduplicates and announces terminal results', async () => {
  let failed = true
  vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(url.includes('/filters/') ? response(filters) : url.includes('cursor=next')
    ? failed ? { ok: false, status: 503 } : response({ results: [video, { ...video, id: 'two', slug: 'salt', recipe_name: 'Salt snack' }], count: 2, next_cursor: null })
    : response({ results: [video], count: 2, next_cursor: 'next' }))))
  queryRender(<Discover />)
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
  expect(await screen.findByText(/Your loaded recipes are still here/)).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: /Crispy potatoes/ })).toHaveLength(1)
  failed = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry more recipes' }))
  expect(await screen.findByRole('link', { name: /Salt snack/ })).toBeInTheDocument()
  expect(screen.getByText('1 recipes added.')).toBeInTheDocument()
  expect(screen.getByText(/reached the end of the results/)).toBeInTheDocument()
})

it('rebuilds saved page depth before restoring scroll and missing-card focus', async () => {
  window.history.replaceState({ archiveEntry: 'saved' }, '', '/')
  writeRecord('archive-entry-saved', { query: '', depth: 2, scroll: 500, card: 'hidden-origin' })
  vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(response(url.includes('/filters/') ? filters : url.includes('cursor=next')
    ? { results: [{ ...video, id: 'two', slug: 'salt' }], count: 2 }
    : { results: [video], count: 2, next_cursor: 'next' }))))
  queryRender(<Discover />)
  await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 500))
  expect(screen.getByRole('heading', { name: 'Recipes', exact: true })).toHaveFocus()
  expect(screen.getAllByRole('link', { name: /Crispy potatoes/ })).toHaveLength(2)
})

it('preserves published player/content outside context and explains disabled neighbors', async () => {
  window.history.replaceState({}, '', '/shorts/potato?diet=VEGAN')
  vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(response(url.includes('neighbors') ? { previous: null, next: null, in_context: false } : video))))
  queryRender(<Watch slug="potato" />)
  expect(await screen.findByText(/no longer matches your search/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  expect(screen.getByRole('link', { name: 'Back to results' })).toHaveAttribute('href', '/?diet=VEGAN')
  expect(fetch.mock.calls.some(([url]) => url.endsWith('/neighbors/?diet=VEGAN'))).toBe(true)
})

it('cancels obsolete searches and never displays their late results', async () => {
  let resolveOld, oldSignal
  vi.stubGlobal('fetch', vi.fn((url, options) => {
    if (url.includes('/filters/')) return Promise.resolve(response(filters))
    if (url.includes('q=old')) { oldSignal = options.signal; return new Promise(resolve => { resolveOld = resolve }) }
    return Promise.resolve(response({ results: [{ ...video, recipe_name: url.includes('q=latest') ? 'Latest recipe' : 'Initial recipe' }], count: 1 }))
  }))
  queryRender(<Discover />)
  await screen.findByRole('link', { name: /Initial recipe/ })
  const input = screen.getByRole('searchbox', { name: 'Search recipes' })
  fireEvent.change(input, { target: { value: 'old' } }); fireEvent.submit(input.closest('form'))
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
  fireEvent.change(input, { target: { value: 'latest' } }); fireEvent.submit(input.closest('form'))
  expect(await screen.findByRole('link', { name: /Latest recipe/ })).toBeInTheDocument()
  expect(oldSignal.aborted).toBe(true)
  await act(async () => resolveOld(response({ results: [{ ...video, recipe_name: 'Obsolete recipe' }], count: 1 })))
  expect(screen.queryByRole('link', { name: /Obsolete recipe/ })).not.toBeInTheDocument()
})

it('isolates ingredient search errors from facet counts and selected controls', async () => {
  vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(url.includes('ingredient_q') ? { ok: false, status: 503 } : response(filters))))
  queryRender(<FilterPanel query={emptyQuery()} onChange={vi.fn()} />)
  expect(await screen.findByRole('checkbox', { name: /Vegan/ })).toBeDisabled()
  const input = screen.getByRole('searchbox', { name: 'Search ingredients' })
  fireEvent.change(input, { target: { value: 'potato' } }); fireEvent.submit(input.closest('form'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Ingredients could not load')
  expect(screen.getByRole('checkbox', { name: /Vegetarian/ })).toBeEnabled()
  expect(screen.getByText('1 matching recipes')).toBeInTheDocument()
})

it('shares clean recipe URLs even when watch navigation has filter context', async () => {
  window.history.replaceState({}, '', '/shorts/potato?q=crispy&diet=VEG#recipe')
  const copy = vi.fn().mockResolvedValue()
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
  render(<ShareActions video={video} />)
  fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  await waitFor(() => expect(copy).toHaveBeenCalledWith('http://localhost:3000/shorts/potato'))
  delete window.navigator.clipboard
})

it('removes hidden recipe metadata and retains the originating Back entry', async () => {
  window.history.replaceState({ archiveOrigin: { url: '/?diet=VEG', steps: 2 } }, '', '/shorts/potato?diet=VEG')
  const content = document.createElement('section')
  content.id = 'recipe-details'; content.textContent = 'Stale hidden recipe'
  document.body.append(content)
  const meta = document.createElement('meta'); meta.setAttribute('property', 'og:title'); meta.content = 'Stale title'; document.head.append(meta)
  const back = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
  queryRender(<Watch slug="potato" />)
  expect(await screen.findByRole('heading', { name: 'Recipe unavailable' })).toBeInTheDocument()
  expect(content.textContent).toBe('')
  expect(document.querySelector('meta[property="og:title"]')).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Back to results' }))
  expect(back).toHaveBeenCalledWith(-2)
  content.remove()
})
import { useState } from 'react'

it('keeps the same focused checkbox during count refresh and selection removal', async () => {
  vi.stubGlobal('fetch', vi.fn(url => url.includes('diet=VEG') ? new Promise(() => {}) : Promise.resolve(response(filters))))
  function ControlledFilters() {
    const [query, setQuery] = useState(emptyQuery())
    return <FilterPanel query={query} onChange={setQuery} />
  }
  queryRender(<ControlledFilters />)
  const checkbox = await screen.findByRole('checkbox', { name: /Vegetarian/ })
  checkbox.focus()
  fireEvent.click(checkbox)
  expect(screen.getByText('Updating filter counts…')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: /Vegetarian/ })).toBe(checkbox)
  expect(checkbox).toHaveFocus()
  fireEvent.click(checkbox)
  expect(screen.getByRole('checkbox', { name: /Vegetarian/ })).toBe(checkbox)
  expect(checkbox).toHaveFocus()
})
