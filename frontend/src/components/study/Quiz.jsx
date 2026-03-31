import { useState } from 'react'
import { CheckCircle, XCircle, RotateCcw, Trophy } from 'lucide-react'
import LatexText from '../LatexText.jsx'
import './Study.css'

async function recordMistake(lectureId, q, selectedIdx, questionType, concept) {
  if (!lectureId) return
  try {
    await fetch('/api/mistakes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lecture_id:     lectureId,
        question_text:  q.question,
        question_type:  questionType || 'quiz',
        concept:        concept || null,
        correct_answer: q.options?.[q.correct_index] ?? String(q.correct_index),
        wrong_answer:   q.options?.[selectedIdx] ?? String(selectedIdx),
        options:        q.options || [],
      }),
    })
  } catch {
    // best-effort — don't interrupt the quiz
  }
}

export default function Quiz({ questions, lectureId, concept, questionType = 'quiz' }) {
  const [current, setCurrent] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answered, setAnswered] = useState([])
  const [done, setDone] = useState(false)

  if (!questions || questions.length === 0) {
    return <div className="study-empty">No quiz questions generated</div>
  }

  const q = questions[current]
  const isAnswered = selected !== null

  const handleSelect = (idx) => {
    if (isAnswered) return
    setSelected(idx)
  }

  const handleNext = () => {
    if (selected === null) return
    const correct = selected === q.correct_index
    if (!correct) {
      recordMistake(lectureId, q, selected, questionType, concept)
    }
    const newAnswered = [...answered, { selected, correct }]
    setAnswered(newAnswered)

    if (current + 1 >= questions.length) {
      setDone(true)
    } else {
      setSelected(null)
      setCurrent(c => c + 1)
    }
  }

  const reset = () => {
    setCurrent(0)
    setSelected(null)
    setAnswered([])
    setDone(false)
  }

  if (done) {
    const score = answered.filter(a => a.correct).length
    const pct = Math.round((score / questions.length) * 100)
    return (
      <div className="quiz-done fade-in">
        <Trophy size={48} className={pct >= 70 ? 'trophy-good' : 'trophy-ok'} />
        <h3>Quiz Complete!</h3>
        <div className="quiz-score">{score}/{questions.length}</div>
        <div className="quiz-pct">{pct}%</div>
        <div className="quiz-review">
          {questions.map((q, i) => (
            <div key={i} className={`review-item ${answered[i]?.correct ? 'correct' : 'wrong'}`}>
              <div className="review-icon">
                {answered[i]?.correct ? <CheckCircle size={14} /> : <XCircle size={14} />}
              </div>
              <div className="review-q"><LatexText>{q.question}</LatexText></div>
            </div>
          ))}
        </div>
        <button className="btn-reset" onClick={reset}>
          <RotateCcw size={14} /> Try again
        </button>
      </div>
    )
  }

  return (
    <div className="quiz-container fade-in">
      <div className="quiz-header">
        <span className="quiz-progress">Question {current + 1} of {questions.length}</span>
        <div className="quiz-prog-bar">
          <div className="quiz-prog-fill" style={{ width: `${(current / questions.length) * 100}%` }} />
        </div>
      </div>

      <div className="quiz-question">
        <LatexText block>{q.question}</LatexText>
      </div>

      <div className="quiz-options">
        {(q.options || []).map((opt, i) => {
          let cls = 'quiz-option'
          if (isAnswered) {
            if (i === q.correct_index) cls += ' correct'
            else if (i === selected) cls += ' wrong'
          } else if (i === selected) {
            cls += ' selected'
          }
          return (
            <button key={i} className={cls} onClick={() => handleSelect(i)}>
              <span className="option-letter">{String.fromCharCode(65 + i)}</span>
              <span className="option-text"><LatexText>{opt}</LatexText></span>
              {isAnswered && i === q.correct_index && <CheckCircle size={14} className="option-icon" />}
              {isAnswered && i === selected && i !== q.correct_index && <XCircle size={14} className="option-icon" />}
            </button>
          )
        })}
      </div>

      {isAnswered && (
        <div className={`quiz-feedback ${selected === q.correct_index ? 'correct' : 'wrong'}`}>
          {selected === q.correct_index
            ? <><CheckCircle size={14} /> Correct!</>
            : <><XCircle size={14} /> Incorrect. The answer is: <LatexText>{q.options?.[q.correct_index]}</LatexText></>
          }
        </div>
      )}

      <button
        className="btn-next"
        onClick={handleNext}
        disabled={selected === null}
      >
        {current + 1 >= questions.length ? 'Finish' : 'Next'}
      </button>
    </div>
  )
}
