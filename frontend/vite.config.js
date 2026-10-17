import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'private-account-documents',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (/^\/(login|signup|settings)\/?(?:\?|$)/.test(request.url)) {
            const writeHead = response.writeHead
            response.writeHead = function (...args) {
              // Vite's HTML middleware otherwise replaces this with no-cache.
              this.setHeader('Cache-Control', 'private, no-store')
              this.setHeader('X-Robots-Tag', 'noindex, nofollow')
              return writeHead.apply(this, args)
            }
          }
          next()
        })
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    cors: { origin: /^http:\/\/(localhost|127\.0\.0\.1):8000$/ },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
      '/healthz': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/shorts': { target: 'http://127.0.0.1:8000' },
      '/_allauth': { target: 'http://127.0.0.1:8000' },
      '/accounts': { target: 'http://127.0.0.1:8000' },
      '/django-admin': { target: 'http://127.0.0.1:8000' },
      '/static': { target: 'http://127.0.0.1:8000' },
    },
  },
  build: { manifest: true, rollupOptions: { input: { app: 'index.html', watch: 'src/main.jsx' } } },
  test: {
    include: ['src/**/*.test.{js,jsx}'],
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
})
