import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CookbookRoute } from './Cookbooks'
import { RecipeActivity, SaveDialog } from './RecipeActivity'
import { safeReturn } from '../lib/accounts'

let auth, request, books, memberships, liked, fail
vi.mock('../app/auth', () => ({ useAuth: () => auth }))
const id = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const video = {
  id,
  slug: 'qa-recipe',
  recipe_name: 'QA recipe',
  thumbnail_url: null,
  meal_types: [],
  cuisines: [],
  like_count: 4,
}
let detail

function mount(element, path = '/cookbooks') {
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const ui = render(
    <QueryClientProvider client={queries}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={element} />
          <Route path="/login" element={<h1>Login required</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...ui, queries }
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  books = [
    { id, name: 'Dinner आलू আলু', count: 1 },
    { id: second, name: 'Snacks', count: 0 },
  ]
  memberships = [id]
  liked = false
  fail = null
  detail = {
    id,
    name: 'Private collection',
    description: '',
    count: 2,
    items: [
      { video_id: id, position: 0, state: 'archive_unavailable' },
      {
        video_id: second,
        position: 1,
        state: 'source_unavailable',
        video: {
          ...video,
          id: second,
          recipe_name: 'Recognizable unavailable recipe',
        },
      },
    ],
  }
  request = vi.fn(async (path, options = {}) => {
    if (fail) await fail(path, options)
    if (path.includes('video-state'))
      return { results: { [id]: { liked, cookbook_ids: [...memberships] } } }
    if (path.endsWith('/like/')) {
      liked = options.method === 'POST'
      return { liked, like_count: 5 }
    }
    if (path.endsWith('/reorder/')) {
      detail.items = options.body.video_ids.map((key, position) => ({
        ...detail.items.find((item) => item.video_id === key),
        position,
      }))
      return {}
    }
    if (path.includes('/items/')) {
      const book = path.split('/')[4]
      if (options.method === 'POST')
        memberships = [...new Set([...memberships, book])]
      else memberships = memberships.filter((key) => key !== book)
      return null
    }
    if (path === '/api/v1/cookbooks/') {
      if (options.method === 'POST') {
        books = [...books, { id: 'new', name: options.body.name, count: 0 }]
        return books.at(-1)
      }
      return {
        results: books.map((book) => ({ ...book })),
        limits: { cookbooks: 10, items: 200 },
      }
    }
    if (options.method === 'PATCH') detail = { ...detail, ...options.body }
    return { ...detail, items: [...detail.items] }
  })
  auth = {
    status: 'authenticated',
    user: { id: 'account-a' },
    client: { request },
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('allows only safe Cookbook return paths and retains Watch context/confirmation', () => {
  expect(safeReturn(`/cookbooks/${id}`)).toBe(`/cookbooks/${id}`)
  expect(safeReturn('/cookbooks')).toBe('/cookbooks')
  expect(safeReturn('/shorts/qa?diet=VEG#confirm-like')).toBe(
    '/shorts/qa?diet=VEG#confirm-like',
  )
  for (const path of [
    '//evil.invalid/cookbooks',
    'https://evil.invalid',
    '/django-admin/',
    '/api/v1/cookbooks/',
    '/cookbooks/%ZZ',
    '/cookbooks/%2f%2fevil',
    '/cookbooks/../django-admin',
    '/cookbooks\\evil',
  ])
    expect(safeReturn(path)).toBe('/')
})

it('protects anonymous deep links without fetching private data', async () => {
  auth = { status: 'anonymous', user: null }
  mount(<CookbookRoute detail />, `/cookbooks/${id}`)
  expect(
    await screen.findByRole('heading', { name: 'Login required' }),
  ).toBeInTheDocument()
  expect(request).not.toHaveBeenCalled()
})

it('shows loading then a specific first-use state and effective limits', async () => {
  books = []
  mount(<CookbookRoute />)
  expect(screen.getByText('Loading Cookbooks…')).toBeInTheDocument()
  expect(
    await screen.findByText('Keep recipes you want to cook'),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Discover recipes' }),
  ).toHaveAttribute('href', '/')
  expect(
    screen.getByText('0 / 10 Cookbooks · Up to 200 recipes each'),
  ).toBeInTheDocument()
})

it('preserves new Cookbook input after a recoverable create failure', async () => {
  mount(<CookbookRoute />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'New Cookbook' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'New Cookbook' }))
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'रसोई রান্না' },
  })
  fail = async (_path, options) => {
    if (options.method === 'POST') throw new Error('Please retry.')
  }
  fireEvent.click(
    screen.getByRole('button', { name: 'Create Cookbook', exact: true }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Please retry.')
  expect(screen.getByLabelText('Name')).toHaveValue('रसोई রান্না')
  fail = null
  fireEvent.click(
    screen.getByRole('button', { name: 'Create Cookbook', exact: true }),
  )
  expect(
    await screen.findByRole('heading', { name: 'रसोई রান্না' }),
  ).toBeInTheDocument()
})

it('renders hidden references without recipe metadata and source-unavailable entries recognizably', async () => {
  mount(<MemoryRouterDetail />, `/cookbooks/${id}`)
  expect(
    await screen.findByText('Recipe no longer available in the archive'),
  ).toBeInTheDocument()
  expect(
    screen.getByText('Recognizable unavailable recipe'),
  ).toBeInTheDocument()
  expect(screen.getByText('Unavailable', { exact: true })).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: /QA recipe/ }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Move up recipe at position 1' }),
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Move down recipe at position 2' }),
  ).toBeDisabled()
})

function MemoryRouterDetail() {
  return (
    <Routes>
      <Route path="/cookbooks/:id" element={<CookbookRoute detail />} />
    </Routes>
  )
}

it('reorders using buttons and reconciles a failed or conflicting order', async () => {
  mount(<MemoryRouterDetail />, `/cookbooks/${id}`)
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Move down recipe at position 1',
    }),
  )
  expect(
    await screen.findByText('Recipe moved to position 2 of 2.'),
  ).toBeInTheDocument()
  const call = request.mock.calls.find(
    ([, options]) => options?.body?.video_ids,
  )
  expect(call[1].body.video_ids).toEqual([second, id])
  fail = async (path) => {
    if (path.endsWith('reorder/')) throw new Error('Order changed. Reload.')
  }
  fireEvent.click(
    screen.getByRole('button', { name: 'Move down recipe at position 1' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Order changed. Reload.',
  )
  expect(detail.items.map((item) => item.video_id)).toEqual([second, id])
})

it('requires a separate confirmation before deleting and cancellation preserves the collection', async () => {
  mount(<MemoryRouterDetail />, `/cookbooks/${id}`)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Delete Cookbook', exact: true }),
  )
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Source videos, your likes and other Cookbooks are preserved.',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(
    request.mock.calls.filter(([, options]) => options?.method === 'DELETE'),
  ).toHaveLength(0)
})

it('anonymous actions prompt login and never issue a mutation', async () => {
  auth = { status: 'anonymous', user: null }
  mount(<RecipeActivity video={video} />)
  fireEvent.click(
    screen.getByRole('button', { name: /Like in this application/ }),
  )
  expect(screen.getByRole('dialog')).toHaveTextContent('After login')
  expect(
    screen
      .getByRole('link', { name: 'Continue to login' })
      .getAttribute('href'),
  ).toContain('confirm-like')
  expect(request).not.toHaveBeenCalled()
})

it('post-login intent fetches current state, requires confirmation, and does not toggle an already satisfied intent', async () => {
  window.history.replaceState({}, '', '/shorts/qa-recipe#confirm-like')
  liked = true
  mount(<RecipeActivity video={video} />)
  expect(
    await screen.findByText('You already like this recipe in the application.'),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm Like' })).toBeDisabled()
  expect(
    request.mock.calls.filter(([, options]) => options?.method),
  ).toHaveLength(0)
  expect(window.location.hash).toBe('')
})

it('sets explicit liked state, prevents rapid duplicate clicks, and leaves failed state unchanged', async () => {
  mount(<RecipeActivity video={video} />)
  const button = await screen.findByRole('button', {
    name: /Like in this application/,
  })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  fireEvent.click(button)
  expect(
    await screen.findByText('Liked in this application.'),
  ).toBeInTheDocument()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /Unlike in this application/ }),
    ).toBeEnabled(),
  )
  expect(
    request.mock.calls.filter(([, options]) => options?.method === 'POST'),
  ).toHaveLength(1)
  fail = async (path) => {
    if (path.endsWith('like/')) throw new Error('Like could not save.')
  }
  fireEvent.click(
    screen.getByRole('button', { name: /Unlike in this application/ }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Like could not save.',
  )
  expect(
    screen.getByRole('button', { name: /Unlike in this application/ }),
  ).toHaveAttribute('aria-pressed', 'true')
})

it('shows real multi-membership, commits only Apply, and leaves failed choices available for retry', async () => {
  mount(<SaveDialog video={video} onClose={vi.fn()} />)
  const first = await screen.findByRole('checkbox', { name: /Dinner/ })
  expect(first).toBeChecked()
  const next = screen.getByRole('checkbox', { name: /Snacks/ })
  fireEvent.click(first)
  fireEvent.click(next)
  expect(
    request.mock.calls.filter(([, options]) => options?.method),
  ).toHaveLength(0)
  fail = async (path, options) => {
    if (path.includes(second) && options.method === 'POST')
      throw new Error('At capacity.')
  }
  fireEvent.click(screen.getByRole('button', { name: 'Apply memberships' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '1 changes saved. Unsaved choices remain selected',
  )
  expect(screen.getByRole('checkbox', { name: /Dinner/ })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: /Snacks/ })).toBeChecked()
  expect(memberships).toEqual([])
  fail = null
  fireEvent.click(screen.getByRole('button', { name: 'Apply memberships' }))
  await waitFor(() => expect(memberships).toEqual([second]))
})

it('closing discards checkbox drafts while creating a collection does not imply saving a recipe', async () => {
  const close = vi.fn()
  mount(<SaveDialog video={video} onClose={close} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: /Snacks/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
  expect(close).toHaveBeenCalled()
  expect(memberships).toEqual([id])
  fireEvent.change(screen.getByLabelText('New Cookbook name'), {
    target: { value: 'Lunch' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Create Cookbook', exact: true }),
  )
  expect(
    await screen.findByText(
      'Cookbook created. Select it below and Apply to save the recipe.',
    ),
  ).toBeInTheDocument()
  expect(memberships).toEqual([id])
})

it('keeps removal possible at capacity and prevents adding to a full unselected Cookbook', async () => {
  books = books.map((book) => ({ ...book, count: 200 }))
  mount(<SaveDialog video={video} onClose={vi.fn()} />)
  expect(await screen.findByRole('checkbox', { name: /Dinner/ })).toBeEnabled()
  expect(screen.getByRole('checkbox', { name: /Snacks/ })).toBeDisabled()
})

it('isolates private query keys and dialogs when the account changes', async () => {
  const view = mount(<RecipeActivity video={video} />)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Add to Cookbook' }),
    ).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add to Cookbook' }))
  await screen.findByRole('checkbox', { name: /Dinner/ })
  auth = { ...auth, user: { id: 'account-b' } }
  memberships = []
  liked = false
  await act(async () =>
    view.rerender(
      <QueryClientProvider client={view.queries}>
        <RecipeActivity video={video} />
      </QueryClientProvider>,
    ),
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(
    view.queries
      .getQueryCache()
      .findAll({ queryKey: ['activity', 'account-a'] })
      .every((query) => query.meta.private),
  ).toBe(true)
  expect(
    view.queries
      .getQueryCache()
      .findAll({ queryKey: ['activity', 'account-b'] }).length,
  ).toBeGreaterThan(0)
})
