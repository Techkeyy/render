import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import SharePage from './SharePage.tsx'
import PublishersPage from './PublishersPage.tsx'

// Tiny path router: /r/:id shows a shared errand, /publishers is onboarding,
// everything else is the app.
const shareMatch = window.location.pathname.match(/^\/r\/([a-z0-9]+)\/?$/i)
const isPublishers = /^\/publishers\/?$/.test(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shareMatch ? <SharePage id={shareMatch[1]} /> : isPublishers ? <PublishersPage /> : <App />}
  </StrictMode>,
)
