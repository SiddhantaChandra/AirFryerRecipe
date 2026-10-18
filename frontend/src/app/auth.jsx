import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { flushSync } from 'react-dom'
import { authPath, createAccountClient } from '../lib/accounts'
import { useTheme } from './theme'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const queries = useQueryClient()
  const { setTheme } = useTheme()
  const [state, setState] = useState({
    status: 'loading',
    user: null,
    error: '',
  })
  const [themeSave, setThemeSave] = useState('saved')
  const generation = useRef(0)
  const userRef = useRef(null)
  const choice = useRef(null)
  const saving = useRef(false)
  const readSequence = useRef(0)
  const themeRevision = useRef(0)
  const clientRef = useRef(null)
  const channel = useRef(null)
  const endingSession = useRef(false)
  const clearPrivate = useCallback(() => {
    generation.current++
    readSequence.current++
    clientRef.current?.cancel()
    userRef.current = null
    choice.current = null
    saving.current = false
    setThemeSave('saved')
    queries.cancelQueries({
      predicate: (query) => query.meta?.private === true,
    })
    queries.removeQueries({
      predicate: (query) => query.meta?.private === true,
    })
    setState({ status: 'anonymous', user: null, error: '' })
  }, [queries])
  const client = useMemo(
    () => createAccountClient(clearPrivate),
    [clearPrivate],
  )
  clientRef.current = client

  const restore = useCallback(
    async ({ mask = false } = {}) => {
      if (endingSession.current) return
      if (mask) {
        clearPrivate()
        setState({ status: 'loading', user: null, error: '' })
      }
      const epoch = generation.current
      const sequence = ++readSequence.current
      const revision = themeRevision.current
      const pendingTheme = !!choice.current
      try {
        await client.bootstrap()
        const user = await client.request('/api/v1/me/', {
          allowAnonymous: true,
        })
        if (epoch !== generation.current || sequence !== readSequence.current)
          return
        if (userRef.current && userRef.current.id !== user.id) {
          clearPrivate()
          // The session changed in another tab. Fetch a fresh token for that session.
          return restore({ mask: true })
        }
        userRef.current = user
        setState({ status: 'authenticated', user, error: '' })
        if (
          !choice.current &&
          !pendingTheme &&
          revision === themeRevision.current
        )
          setTheme(user.theme_preference)
      } catch (error) {
        if (
          epoch !== generation.current ||
          sequence !== readSequence.current ||
          error.name === 'AbortError'
        )
          return
        clearPrivate()
        if (error.status !== 401)
          setState({
            status: 'error',
            user: null,
            error: 'Account could not load. Retry to check your session.',
          })
      }
    },
    [client, clearPrivate, setTheme],
  )

  useEffect(() => {
    restore()
    const show = (event) => {
      if (event.persisted) restore({ mask: true })
    }
    const focus = async (event) => {
      if (event.target === window) {
        await restore()
        queries.invalidateQueries({ predicate: (query) => query.meta?.private === true || ['video', 'videos'].includes(query.queryKey[0]) })
      }
    }
    const hide = () =>
      flushSync(() => {
        clearPrivate()
        setState({ status: 'loading', user: null, error: '' })
      })
    window.addEventListener('pageshow', show)
    window.addEventListener('focus', focus)
    window.addEventListener('pagehide', hide)
    if (typeof window.BroadcastChannel === 'function') {
      channel.current = new window.BroadcastChannel('airfryer-account-session')
      channel.current.onmessage = () => restore({ mask: true })
    }
    return () => {
      generation.current++
      client.cancel()
      window.removeEventListener('pageshow', show)
      window.removeEventListener('focus', focus)
      window.removeEventListener('pagehide', hide)
      channel.current?.close()
      channel.current = null
    }
  }, [client, restore, clearPrivate, queries])

  async function authenticate(operation, body) {
    clearPrivate()
    const epoch = generation.current
    await client.bootstrap()
    await client.request(`${authPath}auth/${operation}`, {
      method: 'POST',
      body,
      allowAnonymous: true,
    })
    if (epoch !== generation.current) return false
    await restore()
    if (epoch === generation.current && userRef.current)
      channel.current?.postMessage('changed')
    return epoch === generation.current && !!userRef.current
  }

  async function logout() {
    endingSession.current = true
    clearPrivate()
    setState({ status: 'loggingOut', user: null, error: '' })
    const epoch = generation.current
    // allauth returns 401 after a successful logout (meta.is_authenticated=false).
    try {
      await client.bootstrap()
      await client.request(`${authPath}auth/session`, {
        method: 'DELETE',
        body: {},
        allowAnonymous: true,
      })
    } catch (error) {
      if (error.status !== 401) {
        endingSession.current = false
        if (epoch !== generation.current) return false
        await restore()
        throw error
      }
    }
    if (epoch === generation.current) {
      clearPrivate()
      channel.current?.postMessage('changed')
    }
    endingSession.current = false
    return true
  }

  async function update(body) {
    const epoch = generation.current
    const user = await client.request('/api/v1/me/', { method: 'PATCH', body })
    if (epoch !== generation.current) return null
    userRef.current = user
    setState({ status: 'authenticated', user, error: '' })
    return user
  }

  async function saveTheme() {
    if (saving.current || !userRef.current || !choice.current) return
    saving.current = true
    const epoch = generation.current
    setThemeSave('saving')
    try {
      while (choice.current && epoch === generation.current) {
        const current = choice.current
        const user = await client.request('/api/v1/me/', {
          method: 'PATCH',
          body: { theme_preference: current },
        })
        if (epoch !== generation.current) return
        userRef.current = user
        setState({ status: 'authenticated', user, error: '' })
        if (choice.current === current) choice.current = null
      }
      if (epoch === generation.current) setThemeSave('saved')
    } catch (error) {
      if (epoch === generation.current && error.name !== 'AbortError')
        setThemeSave('failed')
    } finally {
      if (epoch === generation.current) saving.current = false
    }
  }

  function setPreference(value) {
    if (!['light', 'dark', 'system'].includes(value)) return
    setTheme(value)
    // A pending account read must not apply an older preference over this choice.
    if (userRef.current) {
      themeRevision.current++
      readSequence.current++
      choice.current = value
      saveTheme()
    }
  }

  async function changePassword(body) {
    await client.request(`${authPath}account/password/change`, {
      method: 'POST',
      body,
    })
    await client.bootstrap()
  }

  async function deleteAccount(password) {
    const epoch = generation.current
    endingSession.current = true
    readSequence.current++
    try {
      await client.request('/api/v1/me/', {
        method: 'DELETE',
        body: { password },
      })
      if (epoch === generation.current) {
        clearPrivate()
        setState({
          status: 'anonymous',
          user: null,
          error: '',
          accountDeleted: true,
        })
        channel.current?.postMessage('changed')
      }
    } finally {
      endingSession.current = false
    }
  }

  return (
    <AuthContext.Provider
      value={{
        ...state,
        client,
        themeSave,
        restore,
        authenticate,
        logout,
        update,
        setPreference,
        retryTheme: saveTheme,
        changePassword,
        deleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
