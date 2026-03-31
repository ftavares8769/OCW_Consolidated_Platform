import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { BookOpen, Library, Compass, Layers, Settings, RotateCcw } from 'lucide-react'
import { LibraryPage } from './pages/CoursesPage.jsx'
import DiscoverPage from './pages/CoursesPage.jsx'
import LecturePage from './pages/LecturePage.jsx'
import FlashcardsPage from './pages/FlashcardsPage.jsx'
import ReviewPage from './pages/ReviewPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import './App.css'

export default function App() {
  const [reviewCount, setReviewCount] = useState(0)

  useEffect(() => {
    const load = () =>
      fetch('/api/mistakes')
        .then(r => r.json())
        .then(d => setReviewCount(d.reduce((n, g) => n + g.mistakes.length, 0)))
        .catch(() => {})
    load()
    // Refresh count every 30 s so it stays current as the user does quizzes
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <BrowserRouter>
      <div className="app-layout">
        <nav className="sidebar">
          <div className="sidebar-logo">
            <BookOpen size={24} className="logo-icon" />
            <span className="logo-text">LearnOCW</span>
          </div>
          <div className="sidebar-nav">
            <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Library size={18} />
              <span>Library</span>
            </NavLink>
            <NavLink to="/discover" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Compass size={18} />
              <span>Discover</span>
            </NavLink>
            <NavLink to="/flashcards" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Layers size={18} />
              <span>Flashcards</span>
            </NavLink>
            <NavLink to="/review" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <RotateCcw size={18} />
              <span>Review</span>
              {reviewCount > 0 && (
                <span className="nav-review-badge">{reviewCount}</span>
              )}
            </NavLink>
          </div>
          <div className="sidebar-footer">
            <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Settings size={16} />
              <span>Settings</span>
            </NavLink>
            <span className="sidebar-version">MIT OpenCourseWare</span>
          </div>
        </nav>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/lecture/:lectureId" element={<LecturePage />} />
            <Route path="/flashcards" element={<FlashcardsPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
