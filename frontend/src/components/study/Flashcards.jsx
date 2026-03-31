import { useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, Eye } from 'lucide-react'
import './Study.css'

export default function Flashcards({ cards }) {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [seen, setSeen] = useState(new Set())

  if (!cards || cards.length === 0) {
    return <div className="study-empty">No flashcards generated</div>
  }

  const card = cards[index]
  const seenCount = seen.size

  const goNext = () => {
    setSeen(s => new Set([...s, index]))
    setFlipped(false)
    setTimeout(() => setIndex(i => (i + 1) % cards.length), 150)
  }

  const goPrev = () => {
    setFlipped(false)
    setTimeout(() => setIndex(i => (i - 1 + cards.length) % cards.length), 150)
  }

  const reset = () => {
    setIndex(0)
    setFlipped(false)
    setSeen(new Set())
  }

  return (
    <div className="flashcard-container">
      <div className="flashcard-progress">
        <span>{seenCount}/{cards.length} seen</span>
        <div className="fc-progress-bar">
          <div className="fc-progress-fill" style={{ width: `${(seenCount / cards.length) * 100}%` }} />
        </div>
        <button className="icon-action" onClick={reset} title="Reset">
          <RotateCcw size={13} />
        </button>
      </div>

      <div
        className={`flashcard ${flipped ? 'flipped' : ''}`}
        onClick={() => setFlipped(f => !f)}
      >
        <div className="flashcard-inner">
          <div className="flashcard-front">
            <div className="card-label">Question</div>
            <div className="card-text">{card.q}</div>
            <div className="card-hint"><Eye size={13} /> Click to reveal answer</div>
          </div>
          <div className="flashcard-back">
            <div className="card-label answer-label">Answer</div>
            <div className="card-text">{card.a}</div>
          </div>
        </div>
      </div>

      <div className="flashcard-nav">
        <button className="fc-nav-btn" onClick={goPrev}>
          <ChevronLeft size={18} />
        </button>
        <span className="fc-counter">{index + 1} / {cards.length}</span>
        <button className="fc-nav-btn" onClick={goNext}>
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}
