import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../app/auth'

export const cookbookPath = '/api/v1/cookbooks/'

export function useActivity() {
  const auth = useAuth()
  const queries = useQueryClient()
  const userId = auth?.user?.id
  function reconcile() {
    queries.invalidateQueries({ queryKey: ['activity', userId] })
    queries.invalidateQueries({ queryKey: ['video'] })
    queries.invalidateQueries({ queryKey: ['videos'] })
  }
  return { auth, userId, client: auth?.client, queries, reconcile }
}

export function useCookbooks() {
  const { client, userId } = useActivity()
  return useQuery({
    queryKey: ['activity', userId, 'cookbooks'],
    enabled: !!userId,
    meta: { private: true },
    queryFn: ({ signal }) => client.request(cookbookPath, { signal }),
    refetchOnMount: 'always',
    staleTime: 0,
  })
}

export function useVideoState(ids) {
  const { client, userId } = useActivity()
  const batch = [...new Set(ids)].sort().join(',')
  return useQuery({
    queryKey: ['activity', userId, 'video-state', batch],
    enabled: !!userId && !!batch,
    meta: { private: true },
    queryFn: ({ signal }) =>
      client.request(`/api/v1/me/video-state/?ids=${batch}`, { signal }),
    refetchOnMount: 'always',
    staleTime: 0,
  })
}
