import { useState } from 'react'
import { useAuth } from '../app/auth'
import { loginURL, safeReturn } from '../lib/accounts'

export function AccountActions() {
  const auth = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  if (!auth) return null
  if (auth.status === 'loggingOut') return <p role="status">Logging out…</p>
  if (auth.status === 'loading')
    return (
      <p className="account-loading" role="status">
        Checking account…
      </p>
    )
  if (auth.status === 'error')
    return (
      <div className="account-actions">
        <span role="alert">Account unavailable.</span>
        <button onClick={() => auth.restore({ mask: true })}>
          Retry account
        </button>
      </div>
    )
  const destination = safeReturn(
    `${window.location.pathname}${window.location.search}`,
  )
  async function logout() {
    if (pending) return
    const leaveSettings =
      window.location.pathname.replace(/\/$/, '') === '/settings'
    setPending(true)
    setError('')
    try {
      if ((await auth.logout()) === false) return
      setPending(false)
      if (leaveSettings) window.location.assign('/')
    } catch {
      setError('Could not log out. Retry.')
      setPending(false)
    }
  }
  return (
    <nav className="account-actions" aria-label="Account">
      {auth.user ? (
        <>
          <a href="/settings">Settings</a>
          <button disabled={pending} onClick={logout}>
            {pending ? 'Logging out…' : 'Logout'}
          </button>
        </>
      ) : (
        <>
          <a href={loginURL(destination)}>Login</a>
          <a href={`/signup?next=${encodeURIComponent(destination)}`}>Signup</a>
        </>
      )}
      {error && <span role="alert">{error}</span>}
    </nav>
  )
}
