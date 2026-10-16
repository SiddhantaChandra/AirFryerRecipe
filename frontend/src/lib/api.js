export async function publicRequest(url, signal) {
  const response = await fetch(url, { signal, credentials: 'omit', cache: 'no-cache' })
  if (!response.ok) {
    let message = response.status === 404 ? 'Recipe no longer available in the archive.' : 'The archive could not load. Please retry.'
    if (response.status === 400) {
      try { message = Object.values(await response.json()).flat().join(' ') } catch { message = 'Check the search and filter values.' }
    }
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return response.json()
}

export const catalog = (path, signal) => publicRequest(`/api/v1/videos/${path}`, signal)
