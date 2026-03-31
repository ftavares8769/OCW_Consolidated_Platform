import { useState } from 'react'
import { Layers, Loader } from 'lucide-react'
import Flashcards from '../study/Flashcards.jsx'
import Quiz from '../study/Quiz.jsx'
import ProblemSet from '../study/ProblemSet.jsx'
import './Tab.css'

const SUBTABS = [
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'problems', label: 'Problems' },
  { id: 'notes', label: 'Notes' },
]

export default function MaterialsTab({ materials, status }) {
  const [sub, setSub] = useState('flashcards')

  const isProcessing = status !== 'done' && status !== 'error'
  const hasContent = materials && (
    (materials.flashcards?.length > 0) ||
    (materials.quiz?.length > 0) ||
    (materials.problems?.length > 0) ||
    materials.notes
  )

  if (isProcessing && !hasContent) {
    return (
      <div className="tab-empty">
        <Loader size={28} className="spin" />
        <p>Generating study materials…</p>
        <span className="tab-hint">This may take a few minutes</span>
      </div>
    )
  }

  if (!hasContent) {
    return (
      <div className="tab-empty">
        <Layers size={32} />
        <p>No study materials generated yet</p>
      </div>
    )
  }

  const flashcards = materials.flashcards || []
  const quiz = materials.quiz || []
  const problems = materials.problems || []
  const notes = materials.notes || ''

  return (
    <div className="materials-tab">
      <div className="subtab-bar">
        {SUBTABS.map(st => (
          <button
            key={st.id}
            className={`subtab-btn ${sub === st.id ? 'active' : ''}`}
            onClick={() => setSub(st.id)}
          >
            {st.label}
            {st.id === 'flashcards' && flashcards.length > 0 && <span className="badge">{flashcards.length}</span>}
            {st.id === 'quiz' && quiz.length > 0 && <span className="badge">{quiz.length}</span>}
            {st.id === 'problems' && problems.length > 0 && <span className="badge">{problems.length}</span>}
          </button>
        ))}
      </div>
      <div className="subtab-content">
        {sub === 'flashcards' && <Flashcards cards={flashcards} />}
        {sub === 'quiz' && <Quiz questions={quiz} />}
        {sub === 'problems' && <ProblemSet problems={problems} />}
        {sub === 'notes' && (
          <div className="notes-content">
            {notes ? (
              <div className="notes-text">{typeof notes === 'string' ? notes : JSON.stringify(notes, null, 2)}</div>
            ) : (
              <div className="tab-empty"><p>No notes generated</p></div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
