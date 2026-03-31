import { useState, useEffect, useCallback } from 'react'
import { RotateCcw, X } from 'lucide-react'
import SessionSummary from './SessionSummary.jsx'
import './Flashcards.css'

const RATINGS = [
  { value: 1, label: 'Again', cls: 'btn-again' },
  { value: 2, label: 'Hard',  cls: 'btn-hard'  },
  { value: 3, label: 'Good',  cls: 'btn-good'  },
  { value: 4, label: 'Easy',  cls: 'btn-easy'  },
]

export default function StudySession({ lectureId, lectureTitle, mode, onExit }) {
  const [cards, setCards]       = useState([])
  const [index, setIndex]       = useState(0)
  const [flipped, setFlipped]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const [done, setDone]         = useState(false)
  const [freeMode, setFreeMode] = useState(mode === 'free')
  const [sessionStats, setSessionStats] = useState({
    total: 0, again: 0, hard: 0, good: 0, easy: 0,
  })

  const loadSession = useCallback((overrideFree) => {
    const fm = overrideFree !== undefined ? overrideFree : freeMode
    setLoading(true)
    setDone(false)
    setIndex(0)
    setFlipped(false)
    fetch(`/api/flashcards/session?lecture_id=${lectureId}&mode=${fm ? 'free' : 'normal'}`)
      .then(r => r.json())
      .then(data => {
        setCards(data.cards || [])
        setSessionStats({ total: data.cards?.length || 0, again: 0, hard: 0, good: 0, easy: 0 })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [lectureId, freeMode])

  useEffect(() => { loadSession() }, [lectureId]) // eslint-disable-line

  const handleToggleFree = () => {
    const next = !freeMode
    setFreeMode(next)
    loadSession(next)
  }

  const rate = async (rating) => {
    const card = cards[index]
    if (!card) return
    try {
      await fetch('/api/flashcards/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: card.id, rating, free_review: freeMode }),
      })
    } catch (_) {}

    setSessionStats(prev => ({
      ...prev,
      again: prev.again + (rating === 1 ? 1 : 0),
      hard:  prev.hard  + (rating === 2 ? 1 : 0),
      good:  prev.good  + (rating === 3 ? 1 : 0),
      easy:  prev.easy  + (rating === 4 ? 1 : 0),
    }))

    const next = index + 1
    if (next >= cards.length) {
      setDone(true)
    } else {
      setIndex(next)
      setFlipped(false)
    }
  }

  // ── Loading state ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="study-session">
        <div className="session-topbar">
          <button className="btn-session-exit" onClick={onExit}><X size={16} /> Exit</button>
          <span className="session-deck-title">{lectureTitle}</span>
        </div>
        <div className="session-loading">Loading cards…</div>
      </div>
    )
  }

  // ── Done / empty ───────────────────────────────────────────────
  if (done || cards.length === 0) {
    return (
      <SessionSummary
        lectureTitle={lectureTitle}
        stats={sessionStats}
        onRestart={() => loadSession()}
        onExit={onExit}
        noCards={cards.length === 0}
      />
    )
  }

  // ── Active session ─────────────────────────────────────────────
  const currentCard = cards[index]
  const progress = cards.length > 0 ? index / cards.length : 0

  return (
    <div className="study-session">
      {/* Top bar */}
      <div className="session-topbar">
        <button className="btn-session-exit" onClick={onExit}>
          <X size={16} /> Exit
        </button>
        <span className="session-deck-title">{lectureTitle}</span>
        <label className="free-mode-toggle">
          <input type="checkbox" checked={freeMode} onChange={handleToggleFree} />
          <span>Free review</span>
        </label>
      </div>

      {/* Progress */}
      <div className="session-progress-bar">
        <div className="session-progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="session-counter">{index + 1} / {cards.length}</div>

      {/* 3-D flip card */}
      <div
        className={`study-card${flipped ? ' flipped' : ''}`}
        onClick={() => !flipped && setFlipped(true)}
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 32px', cursor: flipped ? 'default' : 'pointer' }}
      >
        <div
          className="card-inner"
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: 580,
            minHeight: 200,
            transition: 'transform 0.5s cubic-bezier(0.4,0,0.2,1)',
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* Front */}
          <div
            className="card-face card-front"
            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', minHeight: 200 }}
          >
            <div className="card-label">Question</div>
            <div className="card-text">{currentCard.front}</div>
            {currentCard.tags?.length > 0 && (
              <div className="card-tags">
                {currentCard.tags.map((t, i) => <span key={i} className="card-tag">{t}</span>)}
              </div>
            )}
            {!flipped && <div className="card-tap-hint">Tap to reveal answer</div>}
          </div>

          {/* Back */}
          <div
            className="card-face card-back"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              minHeight: 200,
              position: 'absolute',
              top: 0, left: 0, right: 0,
            }}
          >
            <div className="card-label">Answer</div>
            <div className="card-text">{currentCard.back}</div>
            {currentCard.tags?.length > 0 && (
              <div className="card-tags">
                {currentCard.tags.map((t, i) => <span key={i} className="card-tag">{t}</span>)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rating buttons */}
      {flipped && (
        <div className="rating-buttons" style={{ padding: '0 32px 24px', flexShrink: 0 }}>
          {RATINGS.map(r => (
            <button key={r.value} className={`rating-btn ${r.cls}`} onClick={() => rate(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* Flip hint */}
      {!flipped && (
        <div className="flip-hint">
          <RotateCcw size={14} style={{ marginRight: 4 }} /> Click card to flip
        </div>
      )}
    </div>
  )
}
