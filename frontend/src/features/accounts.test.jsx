import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '../app/auth'
import { ThemeProvider } from '../app/theme'
import { ThemeControls } from '../components/ThemeControls'
import { AccountEntry, Settings } from './Accounts'
import { createAccountClient, safeReturn } from '../lib/accounts'

const first = {
  id: 'first',
  email: 'first@example.invalid',
  name: 'Chef',
  theme_preference: 'dark',
}
const second = {
  id: 'second',
  email: 'second@example.invalid',
  name: 'Second chef',
  theme_preference: 'light',
}
let serverUser, calls, patchHandler, meHandler, failure, auth

function response(body, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    headers: { get: () => null },
  }
}
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function Probe() {
  auth = useAuth()
  return (
    <>
      <output data-testid="identity">
        {auth.status}:{auth.user?.email}
      </output>
      <ThemeControls />
      <button onClick={() => auth.logout().catch(() => {})}>Test logout</button>
      <button
        onClick={() =>
          auth
            .authenticate('login', { email: second.email, password: 'test' })
            .catch(() => {})
        }
      >
        Switch account
      </button>
    </>
  )
}
function mount(path = '/settings') {
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  queries.setQueryDefaults(['private'], { meta: { private: true } })
  queries.setQueryData(['private', 'profile'], { private: 'first' })
  render(
    <QueryClientProvider client={queries}>
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <Probe />
            <Routes>
              <Route path="/settings" element={<Settings />} />
              <Route path="/signup" element={<AccountEntry signup />} />
              <Route path="/login" element={<AccountEntry />} />
              <Route path="/" element={<h1>Discover</h1>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return queries
}

beforeEach(() => {
  localStorage.clear()
  serverUser = { ...first }
  calls = []
  patchHandler = null
  meHandler = null
  failure = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      calls.push({ url, ...options })
      const body = options.body ? JSON.parse(options.body) : null
      if (url.endsWith('bootstrap/'))
        return response({ csrf_token: 'in-memory-token' })
      if (url.endsWith('/me/') && options.method === 'GET')
        return meHandler
          ? meHandler()
          : serverUser
            ? response({ ...serverUser })
            : response({}, 401)
      if (url.endsWith('/me/') && options.method === 'PATCH') {
        if (patchHandler) return patchHandler(body)
        if (failure) return response(failure, 400)
        serverUser = { ...serverUser, ...body }
        return response({ ...serverUser })
      }
      if (url.endsWith('/me/') && options.method === 'DELETE') {
        if (failure) return response(failure, 400)
        serverUser = null
        return response(null, 204)
      }
      if (url.endsWith('auth/session')) {
        serverUser = null
        return response({ meta: { is_authenticated: false } }, 401)
      }
      if (url.endsWith('auth/login') || url.endsWith('auth/signup')) {
        if (failure) return response(failure, 400)
        serverUser = { ...second }
        return response({ meta: { is_authenticated: true } })
      }
      if (url.endsWith('password/change'))
        return failure ? response(failure, 400) : response({})
      throw new Error(`Unexpected account request: ${url}`)
    }),
  )
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('account routing and forms', () => {
  it.each([
    'https://external.invalid',
    '//external.invalid',
    '/\\external.invalid',
    '/login',
    '/signup',
    '/api/v1/me/',
    '/settings\n',
    '/%5cexternal.invalid',
    '/%2fexternal.invalid',
    '/shorts/%',
  ])('rejects unsafe return destination %s', (value) => {
    expect(safeReturn(value)).toBe('/')
  })
  it('preserves valid Watch/discovery context', () => {
    expect(safeReturn('/shorts/recipe-1?q=potato&diet=VEG')).toBe(
      '/shorts/recipe-1?q=potato&diet=VEG',
    )
    expect(safeReturn('/?q=potato')).toBe('/?q=potato')
  })
  it('guards direct settings and keeps excluded controls absent', async () => {
    serverUser = null
    mount()
    await screen.findByRole('heading', { name: 'Welcome back' })
    expect(screen.queryByText(first.email)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/forgot|verification|privacy policy|social login/i),
    ).not.toBeInTheDocument()
  })
  it('checks confirmation, prevents duplicate signup, and returns safely', async () => {
    serverUser = null
    mount('/signup?next=https://external.invalid')
    await screen.findByRole('heading', { name: 'Create your account' })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'qa@example.invalid' },
    })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'Example-QA-804!' },
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Passwords must match',
    )
    expect(
      calls.filter((call) => call.url.endsWith('auth/signup')),
    ).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'Example-QA-804!' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await screen.findByRole('heading', { name: 'Discover' })
    expect(
      calls.filter((call) => call.url.endsWith('auth/signup')),
    ).toHaveLength(1)
  })
  it('preserves profile draft on validation failure and retries', async () => {
    mount()
    await screen.findByRole('heading', { name: 'Settings', exact: true })
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly')
    fireEvent.change(screen.getByLabelText('Name (optional)'), {
      target: { value: 'रसोइया রাঁধুনি' },
    })
    failure = { name: ['Try a shorter name.'] }
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await screen.findByText('Try a shorter name.')
    expect(screen.getByLabelText('Name (optional)')).toHaveValue(
      'रसोइया রাঁধুনি',
    )
    expect(screen.getByLabelText('Name (optional)')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    failure = null
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await screen.findByText('Profile saved.')
  })
  it('clears private queries on expiry and ignores old account data', async () => {
    const queries = mount()
    await screen.findByLabelText('Name (optional)')
    patchHandler = () => response({}, 401)
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await screen.findByRole('heading', { name: 'Welcome back' })
    expect(queries.getQueryData(['private', 'profile'])).toBeUndefined()
    expect(screen.queryByDisplayValue(first.email)).not.toBeInTheDocument()
  })
  it('shows allauth field errors and clears password fields on success', async () => {
    mount()
    await screen.findByLabelText('Current password')
    for (const label of [
      'Current password',
      'New password',
      'Confirm new password',
    ])
      fireEvent.change(screen.getByLabelText(label), {
        target: { value: 'Example-QA-804!' },
      })
    failure = {
      errors: [
        { param: 'current_password', message: 'Enter your current password.' },
      ],
    }
    fireEvent.click(
      screen.getByRole('button', { name: 'Change password', exact: true }),
    )
    await screen.findByText('Enter your current password.')
    failure = null
    fireEvent.click(
      screen.getByRole('button', { name: 'Change password', exact: true }),
    )
    await screen.findByText(/Password changed. Other sessions/)
    expect(screen.getByLabelText('Current password')).toHaveValue('')
  })
  it('cancels deletion without mutation and reports successful deletion', async () => {
    mount()
    await screen.findByLabelText('Name (optional)')
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete account', exact: true }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
    expect(
      screen.getByRole('button', { name: 'Delete account', exact: true }),
    ).toHaveFocus()
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete account', exact: true }),
    )
    fireEvent.change(screen.getByLabelText('Confirm with current password'), {
      target: { value: 'Example-QA-804!' },
    })
    failure = { password: ['Enter your current password.'] }
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Permanently delete account',
        exact: true,
      }),
    )
    await screen.findByText('Enter your current password.')
    expect(screen.getByLabelText('Email')).toHaveValue(first.email)
    failure = null
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Permanently delete account',
        exact: true,
      }),
    )
    await screen.findByRole('heading', { name: 'Discover' })
    expect(screen.queryByDisplayValue(first.email)).not.toBeInTheDocument()
  })
})

describe('theme persistence and account isolation', () => {
  it('applies the account theme after a local selection made during session loading', async () => {
    const read = deferred()
    meHandler = () => read.promise
    mount('/')
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    await act(async () => {
      read.resolve(response({ ...first }))
      await read.promise
    })
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    )
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
  })
  it('account preference wins without uploading the anonymous preference', async () => {
    localStorage.setItem('airfryer_theme', 'light')
    mount('/')
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    )
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
    expect(localStorage.getItem('airfryer_theme')).toBe('dark')
  })
  it('serializes rapid choices and ignores a stale focus read', async () => {
    mount('/')
    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent(first.email),
    )
    const save = deferred()
    patchHandler = (body) =>
      body.theme_preference === 'light'
        ? save.promise
        : response({ ...first, ...body })
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }))
    fireEvent.click(screen.getByRole('button', { name: 'System theme' }))
    const read = deferred()
    meHandler = () => read.promise
    fireEvent(window, new Event('focus'))
    await act(async () => {
      save.resolve(response({ ...first, theme_preference: 'light' }))
      await save.promise
    })
    await waitFor(() =>
      expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(2),
    )
    await act(async () => {
      read.resolve(response({ ...first, theme_preference: 'dark' }))
      await read.promise
    })
    expect(
      screen.getByRole('button', { name: 'System theme' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
  it('retains the failed local choice and retries only the latest choice', async () => {
    mount('/')
    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent(first.email),
    )
    patchHandler = () => {
      throw new Error('Offline')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }))
    await screen.findByRole('button', { name: 'Retry theme save' })
    expect(document.documentElement.dataset.theme).toBe('light')
    patchHandler = (body) => response({ ...first, ...body })
    fireEvent.click(screen.getByRole('button', { name: 'Retry theme save' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Retry theme save' }),
      ).not.toBeInTheDocument(),
    )
  })
  it('cancels old saves on logout/account switch and retains browser theme on logout', async () => {
    const queries = mount('/')
    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent(first.email),
    )
    const old = deferred()
    patchHandler = () => old.promise
    fireEvent.click(screen.getByRole('button', { name: 'System theme' }))
    fireEvent.click(screen.getByRole('button', { name: 'Test logout' }))
    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent('anonymous:'),
    )
    expect(
      screen.getByRole('button', { name: 'System theme' }),
    ).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }))
    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent(second.email),
    )
    await act(async () => {
      old.resolve(response({ ...first, theme_preference: 'dark' }))
      await old.promise
    })
    expect(screen.getByTestId('identity')).toHaveTextContent(second.email)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(queries.getQueryData(['private', 'profile'])).toBeUndefined()
    expect(Object.keys(localStorage)).toEqual(['airfryer_theme'])
  })
  it('masks restored-page private data until the session is checked', async () => {
    mount('/')
    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent(first.email),
    )
    serverUser = null
    const event = new Event('pageshow')
    Object.defineProperty(event, 'persisted', { value: true })
    fireEvent(window, event)
    expect(screen.getByTestId('identity')).not.toHaveTextContent(first.email)
    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent('anonymous:'),
    )
  })
  it('removes private forms before a page is cached and restores only the current account', async () => {
    const queries = mount('/settings')
    await screen.findByDisplayValue(first.email)
    fireEvent(window, new Event('pagehide'))
    expect(screen.queryByDisplayValue(first.email)).not.toBeInTheDocument()
    expect(screen.getByTestId('identity')).toHaveTextContent('loading:')
    expect(queries.getQueryData(['private', 'profile'])).toBeUndefined()
    serverUser = { ...second }
    const event = new Event('pageshow')
    Object.defineProperty(event, 'persisted', { value: true })
    fireEvent(window, event)
    await screen.findByDisplayValue(second.email)
    expect(screen.getByLabelText('Name (optional)')).toHaveValue(second.name)
    expect(document.documentElement.dataset.theme).toBe('light')
  })
  it('uses private no-store requests and never replays a forbidden mutation', async () => {
    const client = createAccountClient(() => {})
    await client.bootstrap()
    patchHandler = () => response({ detail: 'CSRF failed.' }, 403)
    await expect(
      client.request('/api/v1/me/', {
        method: 'PATCH',
        body: { name: 'Chef' },
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
    expect(calls.at(-1)).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-CSRFToken': 'in-memory-token' },
    })
  })
})
