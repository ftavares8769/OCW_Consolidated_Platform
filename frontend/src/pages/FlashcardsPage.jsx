import { useState } from 'react'
import DeckBrowser from '../components/flashcards/DeckBrowser.jsx'
import StudySession from '../components/flashcards/StudySession.jsx'
import { Layers } from 'lucide-react'
import './FlashcardsPage.css'

export default function FlashcardsPage() {
  const [session, setSession] = useState(null)
  // session: { lectureId, lectureTitle, mode } | null

  const handleStudy = (lectureId, lectureTitle, mode) => {
    setSession({ lectureId, lectureTitle, mode })
  }

  const handleExit = () => {
    setSession(null)
  }

  return (
    <div className="flashcards-page">
      {/* Left panel: deck browser (always visible) */}
      <DeckBrowser onStudy={handleStudy} />

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
