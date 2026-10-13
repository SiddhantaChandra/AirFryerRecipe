import 'vite/modulepreload-polyfill'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AppProviders } from './app/providers'
import { Watch } from './features/Watch'

const watch = document.getElementById('watch-root')
createRoot(watch || document.getElementById('root')).render(
  <StrictMode>
    {watch ? <AppProviders><Watch slug={watch.dataset.slug} /></AppProviders> : <App />}
  </StrictMode>,
)
