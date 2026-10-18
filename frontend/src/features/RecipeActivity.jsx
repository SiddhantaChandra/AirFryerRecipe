import { useEffect, useRef, useState } from 'react'
import { Heart, BookPlus } from 'lucide-react'
import { useAuth } from '../app/auth'
import { ActivityDialog } from '../components/ActivityDialog'
import { loginURL } from '../lib/accounts'
import {
  cookbookPath,
  useActivity,
  useCookbooks,
  useVideoState,
} from '../lib/activity'
import { FormFeedback } from './Accounts'

export function RecipeActivity({ video }) {
  const auth = useAuth()
  return (
    <ActivityControls
      key={`${auth?.user?.id || auth?.status}:${video.id}`}
      video={video}
    />
  )
}

function ActivityControls({ video }) {
  const { auth, userId, client, reconcile } = useActivity()
  const state = useVideoState([video.id])
  const [dialog, setDialog] = useState(() => {
    const intent = window.location.hash
    if (userId && ['#confirm-like', '#confirm-save'].includes(intent)) {
      return intent === '#confirm-like' ? 'confirm-like' : 'save'
    }
    return null
  })
  useEffect(() => {
    if (
      userId &&
      ['#confirm-like', '#confirm-save'].includes(window.location.hash)
    ) {
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      )
    }
  }, [userId])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [feedback, setFeedback] = useState('')
  const lock = useRef(false)
  const personal = state.data?.results?.[video.id]
  const checking = userId && (state.isPending || state.isFetching)
  async function like(desired) {
    if (lock.current) return
    lock.current = true
    setPending(true)
    setError(null)
    try {
      await client.request(`/api/v1/videos/${video.id}/like/`, {
        method: desired ? 'POST' : 'DELETE',
        body: {},
      })
      setFeedback(
        desired ? 'Liked in this application.' : 'Application like removed.',
      )
      setDialog(null)
    } catch (failure) {
      if (failure.name !== 'AbortError') setError(failure)
    } finally {
      lock.current = false
      setPending(false)
      reconcile()
    }
  }
  function open(action) {
    setError(null)
    if (!userId) setDialog(`login-${action}`)
    else if (action === 'like') like(!personal?.liked)
    else setDialog('save')
  }
  const disabled =
    pending ||
    (!!userId && state.isPending) ||
    ['loading', 'loggingOut', 'error'].includes(auth?.status) ||
    (!!userId && (!personal || state.isError))
  return (
    <>
      <button
        disabled={disabled}
        aria-pressed={!!personal?.liked}
        aria-busy={pending || checking}
        aria-label={`${personal?.liked ? 'Unlike' : 'Like'} in this application, ${video.like_count ?? 0} likes`}
        onClick={() => open('like')}
      >
        <Heart size={20} aria-hidden="true" />
        {pending ? 'Saving…' : personal?.liked ? 'Liked' : 'Like'} ·{' '}
        {video.like_count ?? 0}
        <small>Application likes</small>
      </button>
      <button disabled={disabled} onClick={() => open('save')}>
        <BookPlus size={20} aria-hidden="true" />
        Add to Cookbook
      </button>
      {state.isError && (
        <div role="alert">
          Could not load your recipe state.{' '}
          <button onClick={() => state.refetch()}>Retry recipe state</button>
        </div>
      )}
      {userId && !checking && !state.isError && !personal && (
        <p role="status">Recipe no longer available in the archive.</p>
      )}
      <FormFeedback error={error} success={feedback} />
      {dialog?.startsWith('login-') && (
        <ActivityDialog
          title="Log in to save recipes"
          onClose={() => setDialog(null)}
        >
          <p>
            Application likes and Cookbooks belong to your account. After login,
            review the current state and confirm your choice.
          </p>
          <a
            className="primary-button"
            href={loginURL(
              `${window.location.pathname}${window.location.search}#confirm-${dialog.slice(6)}`,
            )}
          >
            Continue to login
          </a>
        </ActivityDialog>
      )}
      {dialog === 'confirm-like' && userId && (
        <ActivityDialog
          title="Confirm application like"
          onClose={() => setDialog(null)}
          busy={pending}
        >
          <p>
            {personal?.liked
              ? 'You already like this recipe in the application.'
              : 'Review the recipe, then confirm your application like.'}
          </p>
          <button
            disabled={disabled || checking || personal?.liked}
            onClick={() => like(true)}
          >
            Confirm Like
          </button>
        </ActivityDialog>
      )}
      {dialog === 'save' && userId && (
        <SaveDialog
          video={video}
          onClose={() => setDialog(null)}
          onSaved={() => setFeedback('Cookbook memberships saved.')}
        />
      )}
    </>
  )
}

export function SaveDialog({ video, onClose, onSaved }) {
  const { client, reconcile } = useActivity()
  const books = useCookbooks()
  const state = useVideoState([video.id])
  const [choices, setChoices] = useState({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const lock = useRef(false)
  const memberships = state.data?.results?.[video.id]?.cookbook_ids
  const loading = books.isPending || state.isPending
  const failed = books.isError || state.isError
  const gone = !loading && !failed && !memberships
  const actual = new Set(memberships || [])
  const selected = (id) =>
    Object.hasOwn(choices, id) ? choices[id] : actual.has(id)
  async function create(event) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true
    setPending(true)
    setError(null)
    try {
      await client.request(cookbookPath, { method: 'POST', body: { name } })
      setName('')
      setMessage(
        'Cookbook created. Select it below and Apply to save the recipe.',
      )
    } catch (failure) {
      if (failure.name !== 'AbortError') setError(failure)
    } finally {
      lock.current = false
      setPending(false)
      reconcile()
    }
  }
  async function apply() {
    if (lock.current) return
    lock.current = true
    setPending(true)
    setError(null)
    setMessage('')
    const failures = [],
      remaining = { ...choices }
    let saved = 0
    try {
      // Each membership is its own desired-state transaction. Keep successful
      // choices distinguishable if another collection fails or reaches capacity.
      for (const book of books.data.results) {
        if (!Object.hasOwn(choices, book.id)) continue
        const desired = choices[book.id]
        try {
          await client.request(
            `${cookbookPath}${book.id}/items/${desired ? '' : `${video.id}/`}`,
            {
              method: desired ? 'POST' : 'DELETE',
              body: desired ? { video_id: video.id } : {},
            },
          )
          delete remaining[book.id]
          saved++
        } catch (failure) {
          if (failure.name === 'AbortError') throw failure
          failures.push(
            `${book.name}: ${failure.fields?.detail || failure.message}`,
          )
        }
      }
      setChoices(remaining)
      if (failures.length) {
        setError({
          message: `${saved} changes saved. Unsaved choices remain selected for retry. ${failures.join(' ')}`,
        })
      } else {
        setMessage('Membership changes saved.')
        onSaved?.()
        onClose()
      }
    } catch (failure) {
      if (failure.name !== 'AbortError') setError(failure)
    } finally {
      lock.current = false
      setPending(false)
      reconcile()
    }
  }
  return (
    <ActivityDialog title="Add to Cookbook" onClose={onClose} busy={pending}>
      <p>
        Choose any of your private Cookbooks. Apply saves changes; Close
        discards choices that have not been applied. A created Cookbook remains
        in your library.
      </p>
      {loading ? (
        <p role="status">Loading Cookbooks…</p>
      ) : failed ? (
        <div role="alert">
          Could not load memberships.{' '}
          <button
            onClick={() => {
              books.refetch()
              state.refetch()
            }}
          >
            Retry
          </button>
        </div>
      ) : gone ? (
        <p role="alert">Recipe no longer available in the archive.</p>
      ) : (
        <>
          {!books.data.results.length && (
            <p>No Cookbooks yet. Create your first one below.</p>
          )}
          <fieldset disabled={pending}>
            <legend>Your Cookbooks</legend>
            {books.data.results.map((book) => (
              <label className="membership-choice" key={book.id}>
                <input
                  type="checkbox"
                  checked={selected(book.id)}
                  disabled={
                    !actual.has(book.id) &&
                    book.count >= books.data.limits.items
                  }
                  onChange={(event) =>
                    setChoices({ ...choices, [book.id]: event.target.checked })
                  }
                />
                <span>
                  {book.name}
                  <small>
                    {book.count} / {books.data.limits.items} recipes
                    {book.count >= books.data.limits.items
                      ? ' · Full; existing recipes can be removed'
                      : ''}
                    {actual.has(book.id) ? ' · Saved' : ''}
                    {Object.hasOwn(choices, book.id) ? ' · Unsaved choice' : ''}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          {books.data.results.length < books.data.limits.cookbooks ? (
            <form onSubmit={create} className="cookbook-form">
              <label>
                New Cookbook name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={150}
                  disabled={pending}
                />
              </label>
              <button disabled={pending || !name.trim()}>
                Create Cookbook
              </button>
            </form>
          ) : (
            <p>
              You have reached the limit of {books.data.limits.cookbooks}{' '}
              Cookbooks. Existing memberships can still be changed.
            </p>
          )}
          <button
            className="primary-button"
            disabled={pending || !Object.keys(choices).length}
            onClick={apply}
          >
            {pending ? 'Saving…' : 'Apply memberships'}
          </button>
        </>
      )}
      <FormFeedback error={error} success={message} />
    </ActivityDialog>
  )
}
