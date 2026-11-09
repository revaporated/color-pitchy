import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { initTheme } from './theme'
import App from './App.tsx'
import StudioPage from './pages/Studio'
import LibraryPage from './pages/Library'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/studio/:projectId" element={<StudioPage />} />
        {/* Studio opens a project from the library. */}
        <Route path="/studio" element={<Navigate to="/library" replace />} />
        <Route path="/songs" element={<Navigate to="/library" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
