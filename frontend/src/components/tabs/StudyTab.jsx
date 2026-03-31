import { useState, useEffect } from 'react'
import { Layers, Loader, Sparkles, RotateCcw, HelpCircle, Send, PlusCircle, X, ChevronDown, ChevronUp } from 'lucide-react'
import Quiz from '../study/Quiz.jsx'
import ProblemSet from '../study/ProblemSet.jsx'
import './Tab.css'

const SUBTABS = [
  { id: 'quiz',     label: 'Quiz' },
  { id: 'problems', label: 'Problems' },
]

export default function StudyTab({ materials, status, lectureId }) {
  const [sub, setSub]               = useState('quiz')
  const [fcExists, setFcExists]     = useState(null)
  const [fcCount, setFcCount]       = useState(0)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError]     = useState(null)
  const [genMsg, setGenMsg]         = useState(null)

  // Concept quiz state
  const [concept, setConcept]             = useState('')
  const [extraQuiz, setExtraQuiz]         = useState([])
  const [extraLoading, setExtraLoading]   = useState(false)
  const [extraError, setExtraError]       = useState(null)
  const [showExtraQuiz, setShowExtraQuiz] = useState(false)

  // More problems state
  const [selectMode, setSelectMode]         = useState(false)
  const [selectedProblems, setSelectedProblems] = useState(new Set())
  const [extraProblems, setExtraProblems]   = useState([])
  const [moreLoading, setMoreLoading]       = useState(false)
  const [moreError, setMoreError]           = useState(null)

  const quiz     = materials?.quiz     || []
  const problems = materials?.problems || []

  useEffect(() => {
    if (!lectureId) return
    fetch(`/api/flashcards/lecture/${lectureId}/exists`)
      .then(r => r.json())
      .then(d => { setFcExists(d.exists); setFcCount(d.count) })
      .catch(() => setFcExists(false))
  }, [lectureId])

  const generate = async (regenerate = false) => {
    setGenerating(true)
    setGenError(null)
    setGenMsg(null)
    try {
      if (regenerate) {
        await fetch(`/api/flashcards/lecture/${lectureId}`, { method: 'DELETE' })
      }
      const res = await fetch(`/api/flashcards/generate/${lectureId}`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Generation failed')
      }
      const data = await res.json()
      setFcExists(true)
      setFcCount(data.cards_created)
      setGenMsg(data.message)
    } catch (e) {
      setGenError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  const requestExtraQuestions = async () => {
    if (!concept.trim() || !lectureId) return
    setExtraLoading(true)
    setExtraError(null)
    setExtraQuiz([])
    setShowExtraQuiz(false)
    try {
      const res = await fetch(`/api/lectures/${lectureId}/study-extra`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept: concept.trim(), n: 5 }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Generation failed')
      }
      const data = await res.json()
      setExtraQuiz(data.quiz || [])
      setShowExtraQuiz(true)
    } catch (e) {
      setExtraError(e.message)
    } finally {
      setExtraLoading(false)
    }
  }

  const toggleSelectMode = () => {
    if (selectMode) {
      setSelectMode(false)
      setSelectedProblems(new Set())
      setMoreError(null)
    } else {
      setSub('problems')
      setSelectMode(true)
      setSelectedProblems(new Set())
      setMoreError(null)
    }
  }

  const toggleProblemSelect = (index) => {
    setSelectedProblems(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const requestMoreProblems = async () => {
    if (selectedProblems.size === 0 || !lectureId) return
    setMoreLoading(true)
    setMoreError(null)
    try {
      const refProblems = [...selectedProblems].sort().map(i => problems[i])
      const res = await fetch(`/api/lectures/${lectureId}/more-problems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problems: refProblems }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Generation failed')
      }
      const data = await res.json()
      setExtraProblems(prev => [...prev, ...(data.problems || [])])
      setSelectMode(false)
      setSelectedProblems(new Set())
    } catch (e) {
      setMoreError(e.message)
    } finally {
      setMoreLoading(false)
    }
  }

  const isGeneratingStudy = status === 'generating_study'
  const isProcessing = status && !['generating_study', 'done', 'error', 'pending'].includes(status)
  const hasStudyContent = quiz.length > 0 || problems.length > 0

  return (
    <div className="materials-tab">
      {/* ── Flashcard generation section ──────────────────── */}
      <div className="generate-fc-section">
        <div className="generate-fc-header">
          <Sparkles size={14} />
          <span>Flashcards</span>
          {fcExists && fcCount > 0 && (
            <span className="fc-count-badge">{fcCount} cards</span>
          )}
        </div>

        {fcExists === null ? (
          <div className="fc-checking"><Loader size={13} className="spin" /> Checking…</div>
        ) : fcExists ? (
          <div className="fc-exists-row">
            <span className="fc-exists-note">
              Deck ready — open <strong>Flashcards</strong> in the sidebar to study.
            </span>
            <button
              className="btn-regenerate-fc"
              onClick={() => generate(true)}
              disabled={generating}
            >
              {generating ? <Loader size={13} className="spin" /> : <RotateCcw size={13} />}
              {generating ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
        ) : (
          <button
            className="btn-generate-fc"
            onClick={() => generate(false)}
            disabled={generating || isProcessing || isGeneratingStudy || !lectureId}
          >
            {generating
              ? <><Loader size={14} className="spin" /> Generating…</>
              : <><Sparkles size={14} /> Generate Flashcards</>
            }
          </button>
        )}

        {genMsg && <div className="gen-success">{genMsg}</div>}
        {genError && <div className="gen-error">{genError}</div>}

        {/* ── More Problems button ───────────────────────── */}
        {problems.length > 0 && (
          <button
            className={`btn-more-problems ${selectMode ? 'active' : ''}`}
            onClick={toggleSelectMode}
            disabled={moreLoading}
          >
            {selectMode
              ? <><X size={14} /> Cancel selection</>
              : <><PlusCircle size={14} /> Generate Similar Problems</>
            }
          </button>
        )}
      </div>

      {/* ── Quiz / Problems subtabs ────────────────────────── */}
      {isProcessing ? (
        <div className="tab-empty">
          <Loader size={28} className="spin" />
          <p>Generating overview…</p>
        </div>
      ) : isGeneratingStudy && !hasStudyContent ? (
        <div className="tab-empty">
          <Loader size={28} className="spin" />
          <p>Generating quiz &amp; problems…</p>
          <span className="tab-hint">Overview is ready — check the Notes tab</span>
        </div>
      ) : !hasStudyContent ? (
        <div className="tab-empty">
          <Layers size={32} />
          <p>No quiz or problems yet</p>
          <span className="tab-hint">Process the lecture to generate quiz questions and practice problems</span>
        </div>
      ) : (
        <>
          {isGeneratingStudy && (
            <div className="study-generating-banner">
              <Loader size={12} className="spin" />
              <span>Quiz &amp; problems are still generating…</span>
            </div>
          )}
          <div className="subtab-bar">
            {SUBTABS.map(st => (
              <button
                key={st.id}
                className={`subtab-btn ${sub === st.id ? 'active' : ''}`}
                onClick={() => { setSub(st.id); if (st.id !== 'problems') setSelectMode(false) }}
              >
                {st.label}
                {st.id === 'quiz'     && quiz.length > 0     && <span className="badge">{quiz.length}</span>}
                {st.id === 'problems' && problems.length > 0 && <span className="badge">{problems.length + extraProblems.length}</span>}
              </button>
            ))}
          </div>
          <div className="subtab-content">
            {sub === 'quiz' && <Quiz questions={quiz} lectureId={lectureId} questionType="quiz" />}
            {sub === 'problems' && (
              <ProblemSet
                problems={problems}
                extraProblems={extraProblems}
                selectMode={selectMode}
                selectedIndices={selectedProblems}
                onToggleSelect={toggleProblemSelect}
              />
            )}
          </div>

          {/* ── Selection action bar ─────────────────────── */}
          {selectMode && sub === 'problems' && (
            <div className="more-problems-bar">
              <span className="more-problems-info">
                {selectedProblems.size === 0
                  ? 'Select problems above to practice more'
                  : `${selectedProblems.size} problem${selectedProblems.size !== 1 ? 's' : ''} selected`
                }
              </span>
              {moreError && <div className="gen-error" style={{ fontSize: 11 }}>{moreError}</div>}
              <button
                className="btn-generate-similar"
                onClick={requestMoreProblems}
                disabled={selectedProblems.size === 0 || moreLoading}
              >
                {moreLoading
                  ? <><Loader size={13} className="spin" /> Generating…</>
                  : <><Sparkles size={13} /> Generate Similar</>
                }
              </button>
            </div>
          )}

          {/* ── Concept quiz generator ────────────────────── */}
          {sub === 'quiz' && (
            <div className="concept-quiz-section">
              <div className="concept-quiz-header">
                <HelpCircle size={14} />
                <span>Need more practice on a specific topic?</span>
              </div>
              <div className="concept-quiz-input-row">
                <input
                  className="concept-quiz-input"
                  placeholder="e.g. integration by parts, chain rule…"
                  value={concept}
                  onChange={e => setConcept(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && requestExtraQuestions()}
                  disabled={extraLoading}
                />
                <button
                  className="concept-quiz-btn"
                  onClick={requestExtraQuestions}
                  disabled={!concept.trim() || extraLoading}
                >
                  {extraLoading
                    ? <Loader size={14} className="spin" />
                    : <Send size={14} />
                  }
                </button>
              </div>
              {extraError && <div className="gen-error" style={{ marginTop: 6 }}>{extraError}</div>}
              {extraQuiz.length > 0 && (
                <div className="concept-quiz-results">
                  <button
                    className="concept-quiz-results-label"
                    onClick={() => setShowExtraQuiz(v => !v)}
                  >
                    <span>{extraQuiz.length} question{extraQuiz.length !== 1 ? 's' : ''} about &ldquo;{concept}&rdquo;</span>
                    {showExtraQuiz ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  {showExtraQuiz && <Quiz questions={extraQuiz} lectureId={lectureId} concept={concept} questionType="concept_quiz" />}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
