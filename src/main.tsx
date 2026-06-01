import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App, { AppErrorBoundary } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
