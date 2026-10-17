export const authPath = '/_allauth/browser/v1/'

export function safeReturn(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
    )
  )
    return '/'
  try {
    const url = new window.URL(value, window.location.origin)
    const path = decodeURIComponent(url.pathname)
    if (url.origin !== window.location.origin || /[\\\s]/.test(path)) return '/'
    if (
      path !== '/' &&
      path !== '/settings' &&
      !/^\/shorts\/[a-zA-Z0-9_-]+\/?$/.test(path)
    )
      return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

export function loginURL(
  destination = `${window.location.pathname}${window.location.search}`,
) {
  return `/login?next=${encodeURIComponent(safeReturn(destination))}`
}

function parseErrors(body) {
  if (Array.isArray(body?.errors)) {
    const fields = {}
    body.errors.forEach((item) => {
      const key = item.param || 'detail'
      fields[key] = [...(fields[key] || []), item.message]
    })
    return fields
  }
  return body && typeof body === 'object' ? body : {}
}

// Each provider owns its tokens, abort controllers and lifecycle. Nothing private
// is persisted in localStorage/sessionStorage or shared with publicRequest().
export function createAccountClient(onExpiry) {
  let csrfToken = null
  const pending = new Set()
  async function request(
    path,
    { method = 'GET', body, allowAnonymous = false } = {},
  ) {
    const controller = new window.AbortController()
    pending.add(controller)
    try {
      const response = await fetch(path, {
        method,
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(method === 'GET' ? {} : { 'X-CSRFToken': csrfToken || '' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const data =
        response.status === 204 ? null : await response.json().catch(() => ({}))
      if (controller.signal.aborted)
        throw new window.DOMException('Account request canceled.', 'AbortError')
      if (response.status === 401 && !allowAnonymous) onExpiry()
      if (!response.ok) {
        const error = new Error(
          response.status === 429
            ? 'Too many attempts. Please wait before trying again.'
            : response.status === 403
              ? 'Security check failed. Refresh and try again.'
              : response.status === 401
                ? 'Your session ended. Please log in again.'
                : response.status >= 500
                  ? 'The account service could not respond. Please retry.'
                  : 'Please check the form and try again.',
        )
        error.status = response.status
        error.fields = parseErrors(data)
        error.retryAfter = response.headers.get('Retry-After')
        throw error
      }
      return data
    } catch (error) {
      if (error.name === 'TypeError' && !error.status)
        throw new Error('Could not connect. Check your connection and retry.', {
          cause: error,
        })
      throw error
    } finally {
      pending.delete(controller)
    }
  }
  return {
    request,
    async bootstrap() {
      const data = await request('/api/v1/auth/bootstrap/', {
        allowAnonymous: true,
      })
      csrfToken = data.csrf_token
    },
    cancel() {
      pending.forEach((controller) => controller.abort())
      pending.clear()
      csrfToken = null
    },
  }
}
