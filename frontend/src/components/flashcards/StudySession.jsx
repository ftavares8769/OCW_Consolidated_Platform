import { useState, useEffect, useCallback } from 'react'
import { RotateCcw, X, Pencil, Trash2, CheckCircle, AlertCircle } from 'lucide-react'
import SessionSummary from './SessionSummary.jsx'
import CardEditModal from './CardEditModal.jsx'
import './Flashcards.css'

const RATINGS = [
  { value: 1, label: 'Again', cls: 'btn-again' },
  { value: 2, label: 'Hard',  cls: 'btn-hard'  },
  { value: 3, label: 'Good',  cls: 'btn-good'  },
  { value: 4, label: 'Easy',  cls: 'btn-easy'  },
]

// Estimate how well the typed answer matches the correct answer
function matchQuality(userAns, correctAns) {
  const norm  = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const u     = norm(userAns)
  const c     = norm(correctAns)
  if (!u) return 'check'
  if (u === c) return 'great'
  const cWords  = c.split(/\s+/).filter(w => w.length > 3)
  if (cWords.length === 0) return (u.includes(c) || c.includes(u)) ? 'great' : 'check'
  const matched = cWords.filter(w => u.includes(w)).length
  const ratio   = matched / cWords.length
  if (ratio >= 0.75) return 'great'
  if (ratio >= 0.4)  return 'good'
  return 'check'
}

export default function StudySession({ lectureId, lectureTitle, mode, onExit }) {
  const [cards, setCards]               = useState([])
  const [index, setIndex]               = useState(0)
  const [flipped, setFlipped]           = useState(false)
  const [loading, setLoading]           = useState(true)
  const [done, setDone]                 = useState(false)
  const [freeMode, setFreeMode]         = useState(mode === 'free')
  const [typeMode, setTypeMode]         = useState(false)
  const [sessionStats, setSessionStats] = useState({
    total: 0, again: 0, hard: 0, good: 0, easy: 0,
  })

  // Type-answer state
  const [typeInput, setTypeInput]         = useState('')
  const [typeRevealed, setTypeRevealed]   = useState(false)
  const [typeQuality, setTypeQuality]     = useState('check')

  // Edit / delete state
  const [editingCard, setEditingCard]     = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const loadSession = useCallback((overrideFree) => {
    const fm = overrideFree !== undefined ? overrideFree : freeMode
    setLoading(true)
    setDone(false)
    setIndex(0)
    setFlipped(false)
    setTypeInput('')
    setTypeRevealed(false)
    setConfirmDelete(false)
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

  const handleToggleType = () => {
    setTypeMode(m => !m)
    setFlipped(false)
    setTypeInput('')
    setTypeRevealed(false)
  }

  const advanceCard = (next) => {
    if (next >= cards.length) {
      setDone(true)
    } else {
      setIndex(next)
      setFlipped(false)
      setTypeInput('')
      setTypeRevealed(false)
      setConfirmDelete(false)
    }
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
    advanceCard(index + 1)
  }

  // Type-answer: submit answer and reveal
  const handleTypeSubmit = () => {
    if (!typeInput.trim()) return
    const card = cards[index]
    if (card) setTypeQuality(matchQuality(typeInput, card.back))
    setTypeRevealed(true)
  }

  // Edit: save updated card back into the cards array
  const handleEditSave = (updatedCard) => {
    setCards(prev => prev.map(c => c.id === updatedCard.id ? updatedCard : c))
    setEditingCard(false)
  }

  // Delete: remove card and stay at the same position (or step back if at end)
  const handleDeleteConfirm = async () => {
    const card = cards[index]
    try {
      await fetch(`/api/flashcards/${card.id}`, { method: 'DELETE' })
    } catch (_) {}
    const newCards = cards.filter(c => c.id !== card.id)
    setCards(newCards)
    setConfirmDelete(false)
    setFlipped(false)
    setTypeInput('')
    setTypeRevealed(false)
    if (newCards.length === 0) {
      setDone(true)
    } else {
      setIndex(index >= newCards.length ? newCards.length - 1 : index)
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
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

  // ── Done / empty ─────────────────────────────────────────────────────────
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

  // ── Active session ───────────────────────────────────────────────────────
  const currentCard = cards[index]
  const progress    = cards.length > 0 ? index / cards.length : 0
  const isRevealed  = typeMode ? typeRevealed : flipped

  const matchCls  = typeQuality === 'great' ? 'match-great' : typeQuality === 'good' ? 'match-good' : 'match-check'
  const matchText = typeQuality === 'great' ? '✓ Looks good'
    : typeQuality === 'good' ? '~ Partial — double-check your answer'
    : '? Check your answer against the correct one'

  return (
    <div className="study-session">
      {/* Edit modal overlay */}
      {editingCard && currentCard && (
        <CardEditModal
          card={currentCard}
          onSave={handleEditSave}
          onClose={() => setEditingCard(false)}
        />
      )}

      {/* Top bar */}
      <div className="session-topbar">
        <button className="btn-session-exit" onClick={onExit}>
          <X size={16} /> Exit
        </button>
        <span className="session-deck-title">{lectureTitle}</span>
        <label className="free-mode-toggle">
          <input type="checkbox" checked={typeMode} onChange={handleToggleType} />
          <span>Type answer</span>
        </label>
        <label className="free-mode-toggle">
          <input type="checkbox" checked={freeMode} onChange={handleToggleFree} />
          <span>Free review</span>
        </label>
      </div>

      {/* Progress bar */}
      <div className="session-progress-bar">
        <div className="session-progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="session-counter">{index + 1} / {cards.length}</div>

      {/* ── Flip mode (default) ──────────────────────────────────────────────── */}
      {!typeMode && (
        <div
          className={`study-card${flipped ? ' flipped' : ''}`}
          onClick={() => !flipped && !confirmDelete && setFlipped(true)}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px 32px',
            cursor: flipped || confirmDelete ? 'default' : 'pointer',
          }}
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
            {/* Front face */}
            <div
              className="card-face card-front"
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', minHeight: 200 }}
            >
              <div className="card-face-header">
                <div className="card-label">Question</div>
                <div className="card-icon-group" onClick={e => e.stopPropagation()}>
                  <button className="card-icon-btn" title="Edit card" onClick={() => setEditingCard(true)}>
                    <Pencil size={13} />
                  </button>
                  <button className="card-icon-btn delete" title="Delete card" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="card-text">{currentCard.front}</div>
              {currentCard.tags?.length > 0 && (
                <div className="card-tags">
                  {currentCard.tags.map((t, i) => <span key={i} className="card-tag">{t}</span>)}
                </div>
              )}
              {!flipped && <div className="card-tap-hint">Tap to reveal answer</div>}
            </div>

            {/* Back face */}
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
              <div className="card-label" style={{ color: 'var(--accent)' }}>Answer</div>
              <div className="card-text">{currentCard.back}</div>
              {currentCard.tags?.length > 0 && (
                <div className="card-tags">
                  {currentCard.tags.map((t, i) => <span key={i} className="card-tag">{t}</span>)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Type-answer mode ─────────────────────────────────────────────────── */}
      {typeMode && (
        <div className="type-mode-wrapper">
          {/* Question */}
          <div className="type-question-card">
            <div className="card-face-header">
              <div className="card-label">Question</div>
              <div className="card-icon-group">
                <button className="card-icon-btn" title="Edit card" onClick={() => setEditingCard(true)}>
                  <Pencil size={13} />
                </button>
                <button className="card-icon-btn delete" title="Delete card" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <div className="card-text">{currentCard.front}</div>
            {currentCard.tags?.length > 0 && (
              <div className="card-tags">
                {currentCard.tags.map((t, i) => <span key={i} className="card-tag">{t}</span>)}
              </div>
            )}
          </div>

          {/* Input (before submit) */}
          {!typeRevealed && (
            <div className="type-input-section">
              <input
                className="type-input"
                value={typeInput}
                onChange={e => setTypeInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleTypeSubmit() }}
                placeholder="Type your answer…"
                autoFocus
              />
              <button
                className="btn-type-submit"
                onClick={handleTypeSubmit}
                disabled={!typeInput.trim()}
              >
                Reveal Answer
              </button>
            </div>
          )}

          {/* Revealed (after submit) */}
          {typeRevealed && (
            <div className="type-revealed-section">
              <div className={`type-match-badge ${matchCls}`}>
                {typeQuality === 'check'
                  ? <AlertCircle size={13} />
                  : <CheckCircle size={13} />}
                {matchText}
              </div>
              <div className="type-answer-block yours">
                <div className="type-answer-label">Your answer</div>
                <div className="type-answer-text">{typeInput}</div>
              </div>
              <div className="type-answer-block correct">
                <div className="type-answer-label">Correct answer</div>
                <div className="type-answer-text">{currentCard.back}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="card-delete-confirm">
          <span>Delete this card permanently?</span>
          <div className="card-delete-confirm-actions">
            <button className="btn-delete-cancel" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="btn-delete-confirm" onClick={handleDeleteConfirm}>Delete</button>
          </div>
        </div>
      )}

      {/* Rating buttons (shown after flip or type-reveal) */}
      {isRevealed && !confirmDelete && (
        <div className="rating-buttons" style={{ padding: '0 32px 24px', flexShrink: 0 }}>
          {RATINGS.map(r => (
            <button key={r.value} className={`rating-btn ${r.cls}`} onClick={() => rate(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* Flip hint (flip mode only, before revealing) */}
      {!isRevealed && !typeMode && !confirmDelete && (
        <div className="flip-hint">
          <RotateCcw size={14} style={{ marginRight: 4 }} /> Click card to flip
        </div>
      )}
    </div>
  )
}
