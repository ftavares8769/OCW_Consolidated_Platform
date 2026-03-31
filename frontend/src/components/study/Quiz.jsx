import { useState } from 'react'
import { CheckCircle, XCircle, RotateCcw, Trophy, Loader } from 'lucide-react'
import LatexText from '../LatexText.jsx'
import './Study.css'

// ── Mistake recording (best-effort, fire-and-forget) ─────────────────────────
async function recordMistake(lectureId, question, questionType, concept, correctAnswer, wrongAnswer, options) {
  if (!lectureId) return
  try {
    await fetch('/api/mistakes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lecture_id:     lectureId,
        question_text:  question,
        question_type:  questionType || 'quiz',
        concept:        concept || null,
        correct_answer: correctAnswer,
        wrong_answer:   wrongAnswer,
        options:        options || [],
      }),
    })
  } catch { /* best-effort */ }
}

// Fill-blank: correct if user's answer includes the correct answer (case-insensitive)
function checkFillBlank(userAns, correctAns) {
  const u = userAns.trim().toLowerCase()
  const c = correctAns.trim().toLowerCase()
  return u === c || u.includes(c)
}

// ── Sub-component: fill-in-the-blank ─────────────────────────────────────────
function FillBlankQuestion({ q, onDone }) {
  const [value, setValue]         = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [correct, setCorrect]     = useState(false)

  const submit = () => {
    if (!value.trim() || submitted) return
    const ok = checkFillBlank(value, q.blank_answer || '')
    setCorrect(ok)
    setSubmitted(true)
    onDone(ok, value.trim())
  }

  return (
    <div className="fill-blank-area">
      {q.hint && <div className="fill-hint">💡 Hint: {q.hint}</div>}
      <div className="fill-input-row">
        <input
          className="fill-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Type your answer…"
          disabled={submitted}
          autoFocus
        />
        {!submitted && (
          <button className="btn-fill-submit" onClick={submit} disabled={!value.trim()}>
            Submit
          </button>
        )}
      </div>
      {submitted && (
        <div className={`quiz-feedback ${correct ? 'correct' : 'wrong'}`}>
          {correct
            ? <><CheckCircle size={14} /> Correct!</>
            : <><XCircle size={14} /> The answer is: <strong>{q.blank_answer}</strong></>
          }
        </div>
      )}
    </div>
  )
}

// ── Sub-component: open-ended with LLM grading ───────────────────────────────
function OpenEndedQuestion({ q, onDone }) {
  const [value, setValue]         = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [grading, setGrading]     = useState(false)
  const [result, setResult]       = useState(null)

  const submit = async () => {
    if (!value.trim() || submitted) return
    setSubmitted(true)
    setGrading(true)
    try {
      const res = await fetch('/api/quiz/grade-open-ended', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question:      q.question,
          sample_answer: q.sample_answer || '',
          user_answer:   value.trim(),
        }),
      })
      const data = await res.json()
      setResult(data)
      onDone((data.score ?? 0) >= 3, value.trim())
    } catch {
      const fallback = { score: null, max_score: 5, feedback: 'Could not grade automatically.' }
      setResult(fallback)
      onDone(false, value.trim())
    } finally {
      setGrading(false)
    }
  }

  const scoreCls = result?.score == null ? ''
    : result.score >= 4 ? 'score-great'
    : result.score >= 3 ? 'score-ok'
    : 'score-low'

  return (
    <div className="open-ended-area">
      <textarea
        className="oe-textarea"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Write your answer here…"
        disabled={submitted}
        rows={4}
      />
      {!submitted && (
        <button className="btn-fill-submit" onClick={submit} disabled={!value.trim()}>
          Submit for grading
        </button>
      )}
      {grading && (
        <div className="oe-grading">
          <Loader size={14} className="spin" /> Grading your answer…
        </div>
      )}
      {result && !grading && (
        <div className="oe-result">
          {result.score !== null && (
            <div className={`oe-score ${scoreCls}`}>{result.score}/{result.max_score}</div>
          )}
          <div className="oe-feedback">{result.feedback}</div>
          {q.sample_answer && (
            <div className="oe-sample">
              <span className="oe-sample-label">Key points:</span> {q.sample_answer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Quiz component ───────────────────────────────────────────────────────
export default function Quiz({ questions, lectureId, concept, questionType = 'quiz' }) {
  const [current, setCurrent]         = useState(0)
  const [history, setHistory]         = useState([])  // [{correct, type}]
  const [done, setDone]               = useState(false)
  // Per-question answered state
  const [answered, setAnswered]       = useState(false)
  const [lastCorrect, setLastCorrect] = useState(false)
  // MCQ-specific selected index
  const [mcqSelected, setMcqSelected] = useState(null)

  if (!questions || questions.length === 0) {
    return <div className="study-empty">No quiz questions generated</div>
  }

  const q     = questions[current]
  const qType = q?.type || 'mcq'   // default to mcq for old stored questions

  const typeLabel = qType === 'fill_blank' ? 'Fill in the Blank'
    : qType === 'open_ended' ? 'Open Answer'
    : 'Multiple Choice'
  const typeCls = qType === 'fill_blank' ? 'badge-fill'
    : qType === 'open_ended' ? 'badge-open'
    : 'badge-mcq'

  function resetQuestion() {
    setAnswered(false)
    setLastCorrect(false)
    setMcqSelected(null)
  }

  // Called by sub-components when the student has answered
  function handleSubDone(correct, userAnswer) {
    setLastCorrect(correct)
    setAnswered(true)
    if (!correct) {
      if (qType === 'fill_blank') {
        recordMistake(
          lectureId, q.question, 'fill_blank', concept,
          q.blank_answer || '', userAnswer || '', [],
        )
      } else if (qType === 'open_ended') {
        recordMistake(
          lectureId, q.question, 'open_ended', concept,
          q.sample_answer || '', userAnswer || '', [],
        )
      }
    }
  }

  // MCQ: clicking an option immediately locks in the answer
  function handleMcqSelect(idx) {
    if (answered) return
    setMcqSelected(idx)
    const correct = idx === q.correct_index
    setLastCorrect(correct)
    setAnswered(true)
    if (!correct) {
      recordMistake(
        lectureId, q.question, questionType, concept,
        q.options?.[q.correct_index] ?? String(q.correct_index),
        q.options?.[idx] ?? String(idx),
        q.options || [],
      )
    }
  }

  function handleNext() {
    if (!answered) return
    const newHistory = [...history, { correct: lastCorrect, type: qType }]
    setHistory(newHistory)
    if (current + 1 >= questions.length) {
      setDone(true)
    } else {
      setCurrent(c => c + 1)
      resetQuestion()
    }
  }

  const reset = () => {
    setCurrent(0)
    setHistory([])
    setDone(false)
    resetQuestion()
  }

  // ── Done screen ──────────────────────────────────────────────────────────
  if (done) {
    const score = history.filter(h => h.correct).length
    const pct   = Math.round((score / questions.length) * 100)
    return (
      <div className="quiz-done fade-in">
        <Trophy size={48} className={pct >= 70 ? 'trophy-good' : 'trophy-ok'} />
        <h3>Quiz Complete!</h3>
        <div className="quiz-score">{score}/{questions.length}</div>
        <div className="quiz-pct">{pct}%</div>
        <div className="quiz-review">
          {questions.map((q, i) => (
            <div key={i} className={`review-item ${history[i]?.correct ? 'correct' : 'wrong'}`}>
              <div className="review-icon">
                {history[i]?.correct ? <CheckCircle size={14} /> : <XCircle size={14} />}
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

  // ── Active question ──────────────────────────────────────────────────────
  return (
    <div className="quiz-container fade-in">
      <div className="quiz-header">
        <div className="quiz-header-row">
          <span className="quiz-progress">Question {current + 1} of {questions.length}</span>
          <span className={`quiz-type-badge ${typeCls}`}>{typeLabel}</span>
        </div>
        <div className="quiz-prog-bar">
          <div className="quiz-prog-fill" style={{ width: `${(current / questions.length) * 100}%` }} />
        </div>
      </div>

      <div className="quiz-question">
        <LatexText block>{q.question}</LatexText>
      </div>

      {/* Multiple choice */}
      {qType === 'mcq' && (
        <>
          <div className="quiz-options">
            {(q.options || []).map((opt, i) => {
              let cls = 'quiz-option'
              if (answered) {
                if (i === q.correct_index) cls += ' correct'
                else if (i === mcqSelected) cls += ' wrong'
              } else if (i === mcqSelected) {
                cls += ' selected'
              }
              return (
                <button key={i} className={cls} onClick={() => handleMcqSelect(i)}>
                  <span className="option-letter">{String.fromCharCode(65 + i)}</span>
                  <span className="option-text"><LatexText>{opt}</LatexText></span>
                  {answered && i === q.correct_index && <CheckCircle size={14} className="option-icon" />}
                  {answered && i === mcqSelected && i !== q.correct_index && <XCircle size={14} className="option-icon" />}
                </button>
              )
            })}
          </div>
          {answered && (
            <div className={`quiz-feedback ${lastCorrect ? 'correct' : 'wrong'}`}>
              {lastCorrect
                ? <><CheckCircle size={14} /> Correct!</>
                : <><XCircle size={14} /> Incorrect. The answer is: <LatexText>{q.options?.[q.correct_index]}</LatexText></>
              }
            </div>
          )}
        </>
      )}

      {/* Fill-in-the-blank — key={current} resets internal state on each new question */}
      {qType === 'fill_blank' && (
        <FillBlankQuestion key={current} q={q} onDone={handleSubDone} />
      )}

      {/* Open-ended — key={current} resets internal state on each new question */}
      {qType === 'open_ended' && (
        <OpenEndedQuestion key={current} q={q} onDone={handleSubDone} />
      )}

      <button
        className="btn-next"
        onClick={handleNext}
        disabled={!answered}
      >
        {current + 1 >= questions.length ? 'Finish' : 'Next'}
      </button>
    </div>
  )
}
