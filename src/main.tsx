import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import StudioPage from './pages/Studio'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/studio" element={<StudioPage />} />
        {/* The old Songs page is now Studio with the mic off. */}
        <Route path="/songs" element={<Navigate to="/studio" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
