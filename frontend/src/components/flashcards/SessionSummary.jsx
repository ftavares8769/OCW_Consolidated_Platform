import { RotateCcw, Home } from 'lucide-react'
import './Flashcards.css'

export default function SessionSummary({ lectureTitle, stats, onRestart, onExit, noCards }) {
  if (noCards) {
    return (
      <div className="session-summary">
        <div className="summary-icon">🎉</div>
        <h2>Nothing due today!</h2>
        <p className="summary-subtitle">{lectureTitle}</p>
        <p className="summary-note">All cards are up to date. Come back tomorrow or use Free Review to practice.</p>
        <div className="summary-actions">
          <button className="btn-summary-restart" onClick={onRestart}>
            <RotateCcw size={15} /> Try Free Review
          </button>
          <button className="btn-summary-exit" onClick={onExit}>
            <Home size={15} /> Back to Decks
          </button>
        </div>
      </div>
    )
  }

  const { total, again, hard, good, easy } = stats
  const reviewed = again + hard + good + easy

  const breakdown = [
    { label: 'Again', count: again, cls: 'bar-again' },
    { label: 'Hard',  count: hard,  cls: 'bar-hard' },
    { label: 'Good',  count: good,  cls: 'bar-good' },
    { label: 'Easy',  count: easy,  cls: 'bar-easy' },
  ]

  return (
    <div className="session-summary">
      <div className="summary-icon">✅</div>
      <h2>Session Complete</h2>
      <p className="summary-subtitle">{lectureTitle}</p>

      <div className="summary-stats">
        <div className="summary-stat">
          <span className="stat-num">{reviewed}</span>
          <span className="stat-lbl">Reviewed</span>
        </div>
        <div className="summary-stat">
          <span className="stat-num">{good + easy}</span>
          <span className="stat-lbl">Correct</span>
        </div>
        <div className="summary-stat">
          <span className="stat-num">{again}</span>
          <span className="stat-lbl">Missed</span>
        </div>
      </div>

      {reviewed > 0 && (
        <div className="summary-breakdown">
          {breakdown.map(b => (
            <div key={b.label} className="breakdown-row">
              <span className="breakdown-label">{b.label}</span>
              <div className="breakdown-bar-bg">
                <div
                  className={`breakdown-bar-fill ${b.cls}`}
                  style={{ width: `${(b.count / reviewed) * 100}%` }}
                />
              </div>
              <span className="breakdown-count">{b.count}</span>
            </div>
          ))}
        </div>
      )}

      <div className="summary-actions">
        <button className="btn-summary-restart" onClick={onRestart}>
          <RotateCcw size={15} /> Study Again
        </button>
        <button className="btn-summary-exit" onClick={onExit}>
          <Home size={15} /> Back to Decks
        </button>
      </div>
    </div>
  )
}
