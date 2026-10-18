import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { GripVertical, ArrowUp, ArrowDown, BookOpen } from 'lucide-react'
import { useAuth } from '../app/auth'
import { ActivityDialog } from '../components/ActivityDialog'
import { loginURL } from '../lib/accounts'
import { cookbookPath, useActivity, useCookbooks } from '../lib/activity'
import { RecipeCard } from './Discover'
import { FormFeedback } from './Accounts'

export function CookbookRoute({ detail = false }) {
  const auth = useAuth()
  const location = useLocation()
  if (auth.status === 'loading' || auth.status === 'loggingOut')
    return <p role="status">Checking account…</p>
  if (auth.status === 'error')
    return (
      <div role="alert">
        {auth.error}
        <button onClick={() => auth.restore({ mask: true })}>
          Retry account
        </button>
      </div>
    )
  if (!auth.user) return <Navigate to={loginURL(location.pathname)} replace />
  return detail ? (
    <CookbookDetail key={auth.user.id + location.pathname} />
  ) : (
    <CookbookLibrary key={auth.user.id} />
  )
}

function BookCover({ cover }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="cookbook-cover">
      {cover?.thumbnail_url && !failed ? (
        <img
          src={cover.thumbnail_url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <BookOpen size={40} aria-hidden="true" />
      )}
    </div>
  )
}

export function CookbookLibrary() {
  const books = useCookbooks()
  const [create, setCreate] = useState(false)
  useEffect(() => {
    document.title = 'My Cookbooks · Air Fryer Shorts'
  }, [])
  return (
    <section className="cookbooks-page">
      <header className="cookbook-heading">
        <div>
          <h1>My Cookbooks</h1>
          <p>Your private recipe collections, ready for the next meal.</p>
        </div>
        <button
          className="primary-button"
          disabled={
            !books.data ||
            books.data.results.length >= books.data.limits.cookbooks
          }
          onClick={() => setCreate(true)}
        >
          New Cookbook
        </button>
      </header>
      {books.isPending ? (
        <p role="status">Loading Cookbooks…</p>
      ) : books.isError ? (
        <LoadError query={books} />
      ) : (
        <>
          <p className="cookbook-limit">
            {books.data.results.length} / {books.data.limits.cookbooks}{' '}
            Cookbooks · Up to {books.data.limits.items} recipes each
          </p>
          {books.data.results.length >= books.data.limits.cookbooks && (
            <p role="status">
              Cookbook limit reached. You can still manage your existing
              collections.
            </p>
          )}
          {books.data.results.length ? (
            <div className="cookbook-grid">
              {books.data.results.map((book) => (
                <a
                  className="cookbook-card"
                  href={`/cookbooks/${book.id}`}
                  key={book.id}
                >
                  <BookCover
                    key={book.cover?.thumbnail_url}
                    cover={book.cover}
                  />
                  <div>
                    <h2>{book.name}</h2>
                    <p>
                      {book.count} saved{' '}
                      {book.count === 1 ? 'recipe' : 'recipes'}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2>Keep recipes you want to cook</h2>
              <p>
                Create a Cookbook, then use Add to Cookbook while watching a
                recipe.
              </p>
              <a href="/">Discover recipes</a>
            </div>
          )}
        </>
      )}
      {create && <CookbookForm onClose={() => setCreate(false)} />}
    </section>
  )
}

function LoadError({ query }) {
  return (
    <div role="alert">
      <p>
        {query.error?.status === 404
          ? 'Cookbook not found or no longer available to this account.'
          : 'Cookbooks could not load.'}
      </p>
      <button onClick={() => query.refetch()}>Retry</button>
      <a href="/cookbooks">My Cookbooks</a>
    </div>
  )
}

function CookbookForm({ book, onClose }) {
  const { client, reconcile } = useActivity()
  const [name, setName] = useState(book?.name || '')
  const [description, setDescription] = useState(book?.description || '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const lock = useRef(false)
  async function submit(event) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true
    setPending(true)
    setError(null)
    try {
      await client.request(`${cookbookPath}${book ? `${book.id}/` : ''}`, {
        method: book ? 'PATCH' : 'POST',
        body: { name, description },
      })
      reconcile()
      onClose()
    } catch (failure) {
      if (failure.name !== 'AbortError') setError(failure)
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  return (
    <ActivityDialog
      title={book ? 'Rename Cookbook' : 'New Cookbook'}
      onClose={onClose}
      busy={pending}
    >
      <form onSubmit={submit} className="cookbook-form">
        <label>
          Name
          <input
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={150}
            required
            disabled={pending}
          />
        </label>
        <label>
          Description (optional)
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            rows={3}
            disabled={pending}
          />
        </label>
        <FormFeedback error={error} />
        <button className="primary-button" disabled={pending || !name.trim()}>
          {pending ? 'Saving…' : book ? 'Save Cookbook' : 'Create Cookbook'}
        </button>
      </form>
    </ActivityDialog>
  )
}

function CookbookDetail() {
  const { id } = useParams()
  const { client, userId, reconcile } = useActivity()
  const navigate = useNavigate()
  const detail = useQuery({
    queryKey: ['activity', userId, 'cookbook', id],
    meta: { private: true },
    queryFn: ({ signal }) =>
      client.request(`${cookbookPath}${id}/`, { signal }),
    refetchOnMount: 'always',
    staleTime: 0,
  })
  const [dialog, setDialog] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState('')
  const handles = useRef(new Map())
  const heading = useRef(null)
  const lock = useRef(false)
  const drag = useRef(null)
  useEffect(() => {
    document.title = 'Private Cookbook · Air Fryer Shorts'
  }, [])
  async function mutate(path, method, body, success, focusId) {
    if (lock.current) return
    lock.current = true
    setPending(true)
    setError(null)
    try {
      await client.request(`${cookbookPath}${id}/${path}`, { method, body })
      if (method === 'DELETE' && !path) {
        reconcile()
        navigate('/cookbooks', {
          replace: true,
          state: { notice: 'Cookbook deleted. Source videos are preserved.' },
        })
        return
      }
      await detail.refetch()
      setMessage(success)
      if (focusId) handles.current.get(focusId)?.focus({ preventScroll: true })
      else heading.current?.focus({ preventScroll: true })
    } catch (failure) {
      if (failure.name !== 'AbortError') {
        setError(failure)
        await detail.refetch()
      }
    } finally {
      lock.current = false
      setPending(false)
      reconcile()
    }
  }
  if (detail.isPending) return <p role="status">Loading Cookbook…</p>
  if (detail.isError) return <LoadError query={detail} />
  const book = detail.data
  function move(from, to) {
    if (from === to || to < 0 || to >= book.items.length) return
    const ids = book.items.map((item) => item.video_id)
    const [moving] = ids.splice(from, 1)
    ids.splice(to, 0, moving)
    mutate(
      'reorder/',
      'PATCH',
      { video_ids: ids },
      `Recipe moved to position ${to + 1} of ${ids.length}.`,
      moving,
    )
  }
  return (
    <section className="cookbooks-page">
      <a href="/cookbooks">My Cookbooks</a>
      <header className="cookbook-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {book.name}
          </h1>
          {book.description && (
            <p className="cookbook-description">{book.description}</p>
          )}
          <p>
            {book.count} saved {book.count === 1 ? 'recipe' : 'recipes'}
          </p>
        </div>
        <div className="dialog-actions">
          <button onClick={() => setDialog('rename')}>Rename</button>
          <button className="danger-button" onClick={() => setDialog('delete')}>
            Delete Cookbook
          </button>
        </div>
      </header>
      <FormFeedback error={error} success={message} />
      {!book.items.length ? (
        <div className="empty-state">
          <h2>Find something to cook</h2>
          <p>Use Add to Cookbook on a recipe to save it here.</p>
          <a href="/">Discover recipes</a>
        </div>
      ) : (
        <>
          <p>Drag the handle to reorder, or use Move up and Move down.</p>
          <ol
            className="cookbook-items"
            aria-label="Saved recipes"
            aria-busy={pending}
          >
            {book.items.map((item, index) => (
              <li key={item.video_id} data-saved-video={item.video_id}>
                <div className="saved-recipe">
                  {item.state === 'archive_unavailable' ? (
                    <p className="archive-unavailable">
                      Recipe no longer available in the archive
                    </p>
                  ) : item.state === 'source_unavailable' ? (
                    <div className="unavailable-recipe">
                      <BookCover
                        cover={
                          item.video.thumbnail_url
                            ? { thumbnail_url: item.video.thumbnail_url }
                            : null
                        }
                      />
                      <h2>{item.video.recipe_name}</h2>
                      <p>{item.video.recipe_summary}</p>
                      <p>
                        {item.video.creator_name
                          ? `${item.video.creator_name} · YouTube`
                          : 'YouTube'}
                      </p>
                      <strong>Unavailable</strong>
                      <p>
                        The source cannot currently be played here. Your saved
                        reference is retained.
                      </p>
                    </div>
                  ) : (
                    <RecipeCard video={item.video} />
                  )}
                </div>
                <div className="saved-controls">
                  <span>
                    Position {index + 1} of {book.count}
                  </span>
                  <button
                    className="drag-handle"
                    disabled={pending}
                    ref={(node) => {
                      if (node) handles.current.set(item.video_id, node)
                      else handles.current.delete(item.video_id)
                    }}
                    aria-label={`Reorder recipe at position ${index + 1}`}
                    onPointerDown={(event) => {
                      if (pending) return
                      drag.current = index
                      event.currentTarget.setPointerCapture(event.pointerId)
                    }}
                    onPointerCancel={() => {
                      drag.current = null
                    }}
                    onPointerUp={(event) => {
                      const target = document
                        .elementFromPoint(event.clientX, event.clientY)
                        ?.closest('[data-saved-video]')
                      const to = book.items.findIndex(
                        (entry) =>
                          entry.video_id === target?.dataset.savedVideo,
                      )
                      if (drag.current !== null && to >= 0)
                        move(drag.current, to)
                      drag.current = null
                    }}
                  >
                    <GripVertical size={20} aria-hidden="true" />
                    Drag
                  </button>
                  <button
                    disabled={pending || index === 0}
                    aria-label={`Move up recipe at position ${index + 1}`}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp size={18} aria-hidden="true" />
                    Move up
                  </button>
                  <button
                    disabled={pending || index === book.items.length - 1}
                    aria-label={`Move down recipe at position ${index + 1}`}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown size={18} aria-hidden="true" />
                    Move down
                  </button>
                  <button
                    disabled={pending}
                    aria-label={`Remove recipe at position ${index + 1}`}
                    onClick={() =>
                      mutate(
                        `items/${item.video_id}/`,
                        'DELETE',
                        {},
                        'Recipe removed from this Cookbook.',
                        book.items[index + 1]?.video_id ||
                          book.items[index - 1]?.video_id,
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {dialog === 'rename' && (
        <CookbookForm book={book} onClose={() => setDialog(null)} />
      )}
      {dialog === 'delete' && (
        <ActivityDialog
          title="Delete Cookbook?"
          onClose={() => setDialog(null)}
          busy={pending}
        >
          <p>
            This deletes this private collection and its saved memberships.
            Source videos, your likes and other Cookbooks are preserved.
          </p>
          <FormFeedback error={error} />
          <div className="dialog-actions">
            <button onClick={() => setDialog(null)}>Cancel</button>
            <button
              className="danger-button"
              disabled={pending}
              onClick={() => mutate('', 'DELETE', {})}
            >
              {pending ? 'Deleting…' : 'Confirm Delete Cookbook'}
            </button>
          </div>
        </ActivityDialog>
      )}
    </section>
  )
}
