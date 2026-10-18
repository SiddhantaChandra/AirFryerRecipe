import { useEffect, useId, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../app/auth'
import { ThemeControls } from '../components/ThemeControls'
import { loginURL, safeReturn } from '../lib/accounts'

function Field({ label, name, type = 'text', autoComplete, errors, ...props }) {
  const id = useId()
  const messages = errors?.[name]
  return (
    <div className="account-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={messages ? true : undefined}
        aria-describedby={messages ? `${id}-error` : undefined}
        {...props}
      />
      {messages && (
        <p id={`${id}-error`} className="field-error">
          {Array.isArray(messages) ? messages.join(' ') : String(messages)}
        </p>
      )}
    </div>
  )
}

export function FormFeedback({ error, success }) {
  const ref = useRef(null)
  useEffect(() => {
    if (error) ref.current?.focus()
  }, [error])
  if (error)
    return (
      <div
        ref={ref}
        tabIndex={-1}
        role="alert"
        className="form-feedback error-feedback"
      >
        <p>
          {error.message || 'Could not save. Check your connection and retry.'}
        </p>
        {error.fields?.detail && <p>{String(error.fields.detail)}</p>}
      </div>
    )
  return success ? (
    <p role="status" className="form-feedback success-feedback">
      {success}
    </p>
  ) : null
}

const passwordHelp =
  'Use at least 8 characters. Avoid common passwords, entirely numeric passwords, and passwords similar to your email or name.'

function AccountReturn({ destination }) {
  useEffect(() => {
    if (destination.startsWith('/shorts/')) window.location.replace(destination)
  }, [destination])
  return destination.startsWith('/shorts/') ? <p role="status">Returning to recipe…</p> : <Navigate to={destination} replace />
}

export function AccountEntry({ signup = false }) {
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const destination = safeReturn(
    new URLSearchParams(location.search).get('next'),
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const formRef = useRef(null)
  useEffect(() => {
    document.title = `${signup ? 'Signup' : 'Login'} · Air Fryer Shorts`
  }, [signup])
  if (auth.status === 'loading' || auth.status === 'loggingOut')
    return <p role="status">Checking account…</p>
  if (auth.user) return <AccountReturn destination={destination} />
  if (auth.status === 'error')
    return (
      <>
        <h1>Account unavailable</h1>
        <p role="alert">{auth.error}</p>
        <button onClick={() => auth.restore({ mask: true })}>
          Retry account
        </button>
      </>
    )
  async function submit(event) {
    event.preventDefault()
    if (pending) return
    const data = Object.fromEntries(new window.FormData(event.currentTarget))
    if (signup && data.password !== data.password_confirm) {
      setError({
        message: 'Passwords must match.',
        fields: { password_confirm: ['Enter the same password again.'] },
      })
      return
    }
    setPending(true)
    setError(null)
    try {
      if (await auth.authenticate(signup ? 'signup' : 'login', data)) {
        formRef.current?.reset()
        if (!destination.startsWith('/shorts/')) navigate(destination, { replace: true })
      }
    } catch (failure) {
      if (failure.name !== 'AbortError') setError(failure)
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="account-page">
      <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
      <p>
        {signup
          ? 'Save your preferences for the next time you cook.'
          : 'Log in to manage your account and preferences.'}
      </p>
      <form ref={formRef} onSubmit={submit} aria-busy={pending}>
        <Field
          label="Email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="username"
          errors={error?.fields}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          required
          maxLength={4096}
          autoComplete={signup ? 'new-password' : 'current-password'}
          errors={error?.fields}
        />
        {signup && (
          <>
            <p className="field-help">{passwordHelp}</p>
            <Field
              label="Confirm password"
              name="password_confirm"
              type="password"
              required
              maxLength={4096}
              autoComplete="new-password"
              errors={error?.fields}
            />
          </>
        )}
        <FormFeedback error={error} />
        <button className="primary-button" disabled={pending}>
          {pending ? 'Please wait…' : signup ? 'Create account' : 'Login'}
        </button>
      </form>
      <p>
        {signup ? 'Already have an account? ' : 'New here? '}
        <a
          href={`/${signup ? 'login' : 'signup'}?next=${encodeURIComponent(destination)}`}
        >
          {signup ? 'Login' : 'Create an account'}
        </a>
      </p>
    </div>
  )
}

export function Settings() {
  const auth = useAuth()
  useEffect(() => {
    document.title = 'Settings · Air Fryer Shorts'
  }, [])
  if (auth.status === 'loading' || auth.status === 'loggingOut')
    return <p role="status">Checking account…</p>
  if (auth.status === 'error')
    return (
      <>
        <h1>Account unavailable</h1>
        <p role="alert">{auth.error}</p>
        <button onClick={() => auth.restore({ mask: true })}>
          Retry account
        </button>
      </>
    )
  if (auth.accountDeleted)
    return <Navigate to="/" replace state={{ accountDeleted: true }} />
  if (!auth.user) return <Navigate to={loginURL('/settings')} replace />
  return <SettingsForm key={auth.user.id} />
}

function SettingsForm() {
  const auth = useAuth()
  const [name, setName] = useState(auth.user.name)
  const [profile, setProfile] = useState({})
  const [password, setPassword] = useState({})
  const [deletion, setDeletion] = useState({})
  const dialog = useRef(null)
  const deleteTrigger = useRef(null)
  const passwordForm = useRef(null)
  const deleteForm = useRef(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  function closeConfirmation() {
    if (deletion.pending) return
    dialog.current?.close()
    deleteForm.current?.reset()
    setDeletion({})
    setConfirmOpen(false)
    deleteTrigger.current?.focus()
  }
  async function saveProfile(event) {
    event.preventDefault()
    if (profile.pending) return
    setProfile({ pending: true })
    try {
      if (await auth.update({ name })) setProfile({ success: 'Profile saved.' })
    } catch (error) {
      if (error.name !== 'AbortError') setProfile({ error })
    }
  }
  async function changePassword(event) {
    event.preventDefault()
    if (password.pending) return
    const data = Object.fromEntries(new window.FormData(event.currentTarget))
    if (data.new_password !== data.new_password_confirm) {
      setPassword({
        error: {
          message: 'Passwords must match.',
          fields: { new_password_confirm: ['Enter the same password again.'] },
        },
      })
      return
    }
    setPassword({ pending: true })
    try {
      await auth.changePassword(data)
      passwordForm.current?.reset()
      setPassword({
        success: 'Password changed. Other sessions have been logged out.',
      })
    } catch (error) {
      if (error.name !== 'AbortError') setPassword({ error })
    }
  }
  async function deleteAccount(event) {
    event.preventDefault()
    if (deletion.pending) return
    const data = new window.FormData(event.currentTarget)
    setDeletion({ pending: true })
    try {
      await auth.deleteAccount(data.get('password'))
    } catch (error) {
      if (error.name !== 'AbortError') setDeletion({ error })
    }
  }
  return (
    <div className="account-page settings-page">
      <h1>Settings</h1>
      <section aria-labelledby="profile-heading">
        <h2 id="profile-heading">Profile</h2>
        <Field
          label="Email"
          name="email"
          type="email"
          value={auth.user.email}
          autoComplete="username"
          readOnly
        />
        <form onSubmit={saveProfile} aria-busy={!!profile.pending}>
          <Field
            label="Name (optional)"
            name="name"
            maxLength={150}
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            errors={profile.error?.fields}
          />
          <FormFeedback {...profile} />
          <button disabled={profile.pending}>
            {profile.pending ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </section>
      <section aria-labelledby="theme-heading">
        <h2 id="theme-heading">Appearance</h2>
        <p>Choose Light, Dark, or follow your device with System.</p>
        <ThemeControls />
      </section>
      <section aria-labelledby="password-heading">
        <h2 id="password-heading">Change password</h2>
        <p className="field-help">{passwordHelp}</p>
        <form
          ref={passwordForm}
          onSubmit={changePassword}
          aria-busy={!!password.pending}
        >
          <Field
            label="Current password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={4096}
            errors={password.error?.fields}
          />
          <Field
            label="New password"
            name="new_password"
            type="password"
            autoComplete="new-password"
            required
            maxLength={4096}
            errors={password.error?.fields}
          />
          <Field
            label="Confirm new password"
            name="new_password_confirm"
            type="password"
            autoComplete="new-password"
            required
            maxLength={4096}
            errors={password.error?.fields}
          />
          <FormFeedback {...password} />
          <button disabled={password.pending}>
            {password.pending ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>
      <section aria-labelledby="delete-heading">
        <h2 id="delete-heading">Delete account</h2>
        <p>
          Permanently delete your account and sign out all your sessions. This
          cannot be undone. Recipes in the public archive will remain.
        </p>
        <button
          ref={deleteTrigger}
          className="danger-button"
          onClick={() => {
            setConfirmOpen(true)
            dialog.current.showModal()
          }}
        >
          Delete account
        </button>
      </section>
      <dialog
        ref={dialog}
        className="account-dialog"
        aria-labelledby="confirm-delete-heading"
        onCancel={(event) => {
          event.preventDefault()
          closeConfirmation()
        }}
      >
        {confirmOpen && (
          <>
            <h2 id="confirm-delete-heading">
              Permanently delete your account?
            </h2>
            <p>
              Your account will be removed and all sessions signed out. There is
              no undo.
            </p>
            <form
              ref={deleteForm}
              onSubmit={deleteAccount}
              aria-busy={!!deletion.pending}
            >
              <Field
                label="Confirm with current password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={4096}
                errors={deletion.error?.fields}
              />
              <FormFeedback {...deletion} />
              <div className="dialog-actions">
                <button
                  type="button"
                  autoFocus
                  disabled={deletion.pending}
                  onClick={closeConfirmation}
                >
                  Cancel
                </button>
                <button className="danger-button" disabled={deletion.pending}>
                  {deletion.pending
                    ? 'Deleting…'
                    : 'Permanently delete account'}
                </button>
              </div>
            </form>
          </>
        )}
      </dialog>
    </div>
  )
}
