import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, BookOpen } from 'lucide-react'
import './Flashcards.css'

export default function DeckBrowser({ onStudy }) {
  const [decks, setDecks] = useState([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState({})

  const load = () => {
    setLoading(true)
    fetch('/api/flashcards/decks')
      .then(r => r.json())
      .then(data => { setDecks(data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const toggle = (courseId) =>
    setCollapsed(prev => ({ ...prev, [courseId]: !prev[courseId] }))

  if (loading) {
    return (
      <div className="deck-browser">
        <div className="deck-browser-header">
          <BookOpen size={16} />
          <span>Decks</span>
        </div>
        <div className="deck-loading">Loading decks…</div>
      </div>
    )
  }

  if (!decks.length) {
    return (
      <div className="deck-browser">
        <div className="deck-browser-header">
          <BookOpen size={16} />
          <span>Decks</span>
        </div>
        <div className="deck-empty">
          <p>No flashcard decks yet.</p>
          <span>Open a lecture and generate flashcards to get started.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="deck-browser">
      <div className="deck-browser-header">
        <BookOpen size={16} />
        <span>Decks</span>
        <button className="deck-refresh" onClick={load} title="Refresh">↻</button>
      </div>

      <div className="deck-list">
        {decks.map(course => {
          const isOpen = !collapsed[course.course_id]
          const totalDue = course.lectures.reduce((s, l) => s + l.due_today, 0)
          return (
            <div key={course.course_id} className="course-group">
              <button
                className="course-group-header"
                onClick={() => toggle(course.course_id)}
              >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="course-group-title">{course.course_title}</span>
                {totalDue > 0 && (
                  <span className="badge-due">{totalDue} due</span>
                )}
              </button>

              {isOpen && course.lectures.map(lec => (
                <div key={lec.lecture_id} className="deck-entry">
                  <div className="deck-entry-title">{lec.lecture_title}</div>
                  <div className="deck-badges">
                    <span className="badge badge-new">{lec.new} new</span>
                    <span className="badge badge-learning">{lec.learning} lrn</span>
                    <span className="badge badge-learned">{lec.learned} done</span>
                  </div>
                  <div className="deck-actions">
                    <button
                      className="btn-study"
                      disabled={lec.due_today === 0}
                      onClick={() => onStudy(lec.lecture_id, lec.lecture_title, 'normal')}
                    >
                      Study ({lec.due_today})
                    </button>
                    <button
                      className="btn-free-review"
                      onClick={() => onStudy(lec.lecture_id, lec.lecture_title, 'free')}
                    >
                      Free Review
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
