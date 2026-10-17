import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from './theme'
import { ErrorBoundary } from './ErrorBoundary'
import { AuthProvider } from './auth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: 0,
    },
  },
})

export function AppProviders({ children }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
