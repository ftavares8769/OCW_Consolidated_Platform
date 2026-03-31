import { useState, useEffect } from 'react'
import DeckBrowser from '../components/flashcards/DeckBrowser.jsx'
import StudySession from '../components/flashcards/StudySession.jsx'
import ActivityHeatmap from '../components/ActivityHeatmap.jsx'
import './FlashcardsPage.css'

export default function FlashcardsPage() {
  const [session,  setSession]  = useState(null)
  const [heatmap,  setHeatmap]  = useState({})
  const [streak,   setStreak]   = useState(0)
  const [todayCards, setTodayCards] = useState(0)

  // session: { lectureId, lectureTitle, mode } | null

  useEffect(() => {
    fetch('/api/stats/overview')
      .then(r => r.json())
      .then(d => {
        setHeatmap(d.heatmap || {})
        setStreak(d.streak || 0)
        setTodayCards(d.today_cards || 0)
      })
      .catch(() => {})
  }, [])

  const handleStudy = (lectureId, lectureTitle, mode) => {
    setSession({ lectureId, lectureTitle, mode })
  }

  const handleExit = () => {
    setSession(null)
    // Refresh heatmap after a study session completes
    fetch('/api/stats/overview')
      .then(r => r.json())
      .then(d => {
        setHeatmap(d.heatmap || {})
        setStreak(d.streak || 0)
        setTodayCards(d.today_cards || 0)
      })
      .catch(() => {})
  }

  return (
    <div className="flashcards-page">
      {/* Left panel: heatmap + deck browser */}
      <div className="flashcards-left">
        <div className="fc-heatmap-panel">
          <div className="fc-heatmap-stats">
            <span className="fc-stat"><strong>{todayCards}</strong> today</span>
            {streak > 0 && (
              <span className="fc-stat">🔥 <strong>{streak}</strong>-day streak</span>
            )}
          </div>
          <ActivityHeatmap heatmap={heatmap} compact />
        </div>
        <DeckBrowser onStudy={handleStudy} />
      </div>

      {/* Right panel: session or empty state */}
      <div className="flashcards-right">
        {session ? (
          <StudySession
            key={`${session.lectureId}-${session.mode}-${Date.now()}`}
            lectureId={session.lectureId}
            lectureTitle={session.lectureTitle}
            mode={session.mode}
            onExit={handleExit}
          />
        ) : (
          <div className="flashcards-empty">
            <div className="flashcards-empty-icon">🃏</div>
            <h3>Select a deck to study</h3>
            <p>
              Choose a lecture deck from the left panel and click{' '}
              <strong>Study</strong> to start a spaced-repetition session, or{' '}
              <strong>Free Review</strong> to browse all cards.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
