import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    cors: { origin: /^http:\/\/(localhost|127\.0\.0\.1):8000$/ },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/shorts': { target: 'http://127.0.0.1:8000' },
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
