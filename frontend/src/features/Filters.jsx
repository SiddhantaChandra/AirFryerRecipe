import { useEffect, useId, useRef, useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { publicRequest } from '../lib/api'
import { queryString } from '../lib/discovery'
import { DebouncedSearch } from '../components/DebouncedSearch'

const names = { diet: 'Diet', ingredient: 'Ingredients', cuisine: 'Cuisine', meal_type: 'Meal type', difficulty: 'Difficulty', language: 'Language' }

function Options({ name, options, selected, onChange, pending = false, error = false }) {
  return <div className="filter-options">{options.map(option => <label className="filter-option" key={option.value}>
    <input type="checkbox" checked={selected.includes(option.value)} disabled={option.count === 0 && !selected.includes(option.value)}
      onChange={() => onChange(selected.includes(option.value) ? selected.filter(value => value !== option.value) : [...selected, option.value])} />
    <span>{option.label}</span><span className="option-count" aria-label={option.count == null ? 'Count unavailable' : `${option.count} matching recipes`}>{option.count ?? '…'}</span>
  </label>)}{!options.length && !pending && !error && <p>No matching {name.toLowerCase()} choices.</p>}</div>
}

export function FilterPanel({ query, onChange, preview = false }) {
  const [ingredientSearch, setIngredientSearch] = useState('')
  const [customTime, setCustomTime] = useState('')
  const [timeError, setTimeError] = useState('')
  const id = useId()
  const semantic = queryString(query)
  const known = useRef(new Map())
  const counts = useQuery({ queryKey: ['filter-counts', semantic], queryFn: ({ signal }) => publicRequest(`/api/v1/filters/?${semantic}`, signal), placeholderData: keepPreviousData })
  const choices = useInfiniteQuery({
    queryKey: ['ingredient-options', semantic, ingredientSearch], initialPageParam: null,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams(semantic)
      if (ingredientSearch) params.set('ingredient_q', ingredientSearch)
      if (pageParam) params.set('ingredient_cursor', pageParam)
      return publicRequest(`/api/v1/filters/?${params}`, signal)
    }, getNextPageParam: page => page.ingredient_next_cursor || undefined,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === ingredientSearch ? previous : undefined,
  })
  const data = counts.data
  const optionData = choices.data?.pages[0]
  const counting = counts.isPlaceholderData
  for (const key of Object.keys(names)) for (const option of data?.[key] || []) known.current.set(`${key}:${option.value}`, option.label)
  for (const option of [...(data?.selected_ingredients || []), ...(optionData?.ingredient || [])]) known.current.set(`ingredient:${option.value}`, option.label)
  function retained(key, options) {
    return [...options, ...query[key].filter(value => !options.some(option => option.value === value)).map(value => ({ value, label: known.current.get(`${key}:${value}`) || value, count: null }))]
  }
  const ingredients = [...new Map([
    ...(data?.selected_ingredients || []), ...((choices.data?.pages || []).flatMap(page => page.ingredient || [])),
  ].map(option => [option.value, option])).values()]
  function change(key, value) { onChange({ ...query, [key]: value }) }
  return <div className="filter-panel" aria-busy={counts.isFetching}>
    <h2>Filters</h2>
    <p className="filter-total" role="status">{counts.isPending ? 'Loading filter counts…' : counting ? 'Updating filter counts…' : counts.isError && !data ? 'Filter counts unavailable' : `${data?.count ?? 0} ${preview ? 'recipes with draft filters' : 'matching recipes'}`}</p>
    {counts.isError && !data && <div role="alert"><p>Filters could not load. {counts.error.message}</p><button onClick={() => counts.refetch()}>Retry filters</button></div>}
    {['diet', 'ingredient', 'cuisine', 'meal_type', 'max_time', 'difficulty', 'language'].map(key => <fieldset key={key}>
      <legend>{key === 'max_time' ? 'Maximum cooking time' : names[key]}</legend>
      {key === 'ingredient' && <><p className="filter-help">Recipes must contain all selected ingredients.</p><DebouncedSearch label="Search ingredients" value={ingredientSearch} onSubmit={setIngredientSearch} maxLength={120} /></>}
      {key === 'max_time' ? <>
        <label className="filter-option"><input type="radio" name={`${id}-time`} checked={!query.max_time} onChange={() => change(key, null)} /><span>Any time</span></label>
        {(data?.max_time || []).map(option => <label className="filter-option" key={option.value}>
          <input type="radio" name={`${id}-time`} checked={String(query.max_time) === String(option.value)} disabled={!counting && option.count === 0 && String(query.max_time) !== String(option.value)} onChange={() => change(key, option.value)} />
          <span>{option.label}</span><span className="option-count">{counting ? '…' : option.count}</span></label>)}
        {query.max_time && ![10, 20, 30, 60].includes(Number(query.max_time)) && <p>Selected: {query.max_time} minutes or less <button onClick={() => change(key, null)}>Remove</button></p>}
        <form className="custom-time" onSubmit={event => {
          event.preventDefault()
          if (!/^[0-9]+$/.test(customTime) || Number(customTime) < 1 || Number(customTime) > 2147483647) { setTimeError('Enter positive whole cooking minutes.'); return }
          setTimeError(''); change(key, Number(customTime))
        }}><label htmlFor={`${id}-custom`}>Custom minutes or less</label><div><input id={`${id}-custom`} inputMode="numeric" value={customTime} onChange={event => setCustomTime(event.target.value)} aria-invalid={!!timeError} aria-describedby={timeError ? `${id}-error` : undefined} /><button>Set</button></div>
          {timeError && <p id={`${id}-error`} role="alert">{timeError}</p>}
        </form>
      </> : <Options name={names[key]} options={retained(key, key === 'ingredient' ? ingredients : (data?.[key] || [])).map(option => counting || key === 'ingredient' && choices.isPlaceholderData ? { ...option, count: null } : option)} selected={query[key]} pending={key === 'ingredient' ? choices.isPending : counts.isPending} error={key === 'ingredient' ? choices.isError : counts.isError} onChange={value => change(key, value)} />}
      {key === 'ingredient' && <>
        {choices.isPending && <p role="status">Loading ingredient choices…</p>}
        {ingredientSearch && optionData && !choices.data.pages.some(page => page.ingredient?.length) && <p role="status">No ingredients match this search. Selected ingredients remain available.</p>}
        {choices.isError && !optionData && <p role="alert">Ingredients could not load. <button onClick={() => choices.refetch()}>Retry ingredient choices</button></p>}
        {choices.isFetchNextPageError && <p role="alert">More ingredients could not load.</p>}
        {(choices.hasNextPage || choices.isFetchNextPageError) && <button disabled={choices.isFetching} onClick={() => choices.fetchNextPage({ cancelRefetch: false })}>{choices.isFetchingNextPage ? 'Loading ingredients…' : choices.isFetchNextPageError ? 'Retry ingredients' : 'Load more ingredients'}</button>}
      </>}
    </fieldset>)}
    {counts.isRefetchError && data && <p role="alert">Counts could not refresh. <button onClick={() => counts.refetch()}>Retry filters</button></p>}
  </div>
}

export function FilterDrawer({ query, onApply, onClose }) {
  const [draft, setDraft] = useState(query)
  const dialog = useRef(null)
  useEffect(() => {
    const node = dialog.current
    const trigger = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    node.showModal()
    return () => { node.close(); document.body.style.overflow = overflow; trigger?.focus({ preventScroll: true }) }
  }, [])
  return <dialog className="filter-drawer" ref={dialog} aria-label="Recipe filters" onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onClose() }
  }}>
    <div className="drawer-actions"><button autoFocus onClick={onClose}>Close</button><button className="primary-button" onClick={() => { onApply(draft); onClose() }}>Apply filters</button></div>
    <FilterPanel query={draft} onChange={setDraft} preview />
  </dialog>
}
