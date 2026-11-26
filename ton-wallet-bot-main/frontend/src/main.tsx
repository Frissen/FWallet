import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTelegram } from './lib/telegram'
import { captureReferrerFromLocation } from './lib/referral'

initTelegram()
captureReferrerFromLocation()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
