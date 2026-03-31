import { useState, useEffect, useRef } from 'react'
import { BookMarked, CheckCircle, XCircle, ChevronRight, Sparkles, Loader,
         RotateCcw, MessageSquare, Brain, ChevronDown, ChevronUp, Inbox } from 'lucide-react'
import LatexText from '../components/LatexText.jsx'
import Quiz from '../components/study/Quiz.jsx'
import TutorPanel from '../components/TutorPanel.jsx'
import './ReviewPage.css'

// ── Mistake Card ──────────────────────────────────────────────────────────────
function MistakeCard({ mistake, onMastered }) {
  const [explainLoading, setExplainLoading] = useState(false)
  const [explanation, setExplanation]       = useState(null)
  const [practiceLoading, setPracticeLoading] = useState(false)
  const [practiceQuestions, setPracticeQuestions] = useState(null)
  const [practiceConcept, setPracticeConcept] = useState(null)
  const [expanded, setExpanded] = useState(true)

  const fetchExplanation = async () => {
    if (explanation) { setExpanded(v => !v); return }
    setExplainLoading(true)
    try {
      const r = await fetch(`/api/mistakes/${mistake.id}/explain`, { method: 'POST' })
      const d = await r.json()
      setExplanation(d.explanation)
      setExpanded(true)
    } catch { setExplanation('Unable to generate explanation.') }
    finally { setExplainLoading(false) }
  }

  const fetchPractice = async () => {
    setPracticeLoading(true)
    setPracticeQuestions(null)
    try {
      const r = await fetch(`/api/mistakes/${mistake.id}/practice`, { method: 'POST' })
      const d = await r.json()
      setPracticeQuestions(d.questions || [])
      setPracticeConcept(d.concept || null)
    } catch { setPracticeQuestions([]) }
    finally { setPracticeLoading(false) }
  }

  const markMastered = async () => {
    try {
      await fetch(`/api/mistakes/${mistake.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'mastered' }),
      })
      onMastered(mistake.id)
    } catch {}
  }

  return (
    <div className="mistake-card">
      <div className="mistake-card-header">
        <XCircle size={15} className="mistake-x-icon" />
        <div className="mistake-question">
          <LatexText>{mistake.question_text}</LatexText>
        </div>
        <button className="btn-mastered" onClick={markMastered} title="Mark as understood">
          <CheckCircle size={14} /> Got it
        </button>
      </div>

      <div className="mistake-answers">
        <div className="mistake-answer wrong">
          <span className="answer-label">Your answer</span>
          <LatexText>{mistake.wrong_answer}</LatexText>
        </div>
        <div className="mistake-answer correct">
          <span className="answer-label">Correct</span>
          <LatexText>{mistake.correct_answer}</LatexText>
        </div>
      </div>

      <div className="mistake-actions">
        <button className="btn-explain" onClick={fetchExplanation} disabled={explainLoading}>
          {explainLoading ? <Loader size={13} className="spin" /> : <Brain size={13} />}
          {explanation ? (expanded ? 'Hide explanation' : 'Show explanation') : 'Explain'}
        </button>
        <button className="btn-practice-q" onClick={fetchPractice} disabled={practiceLoading}>
          {practiceLoading ? <Loader size={13} className="spin" /> : <Sparkles size={13} />}
          Practice
        </button>
      </div>

      {explanation && expanded && (
        <div className="mistake-explanation">
          <LatexText block>{explanation}</LatexText>
        </div>
      )}

      {practiceQuestions && practiceQuestions.length > 0 && (
        <div className="mistake-practice">
          <div className="practice-label">
            <Sparkles size={12} />
            Practice: {practiceConcept || 'Related questions'}
          </div>
          <Quiz
            questions={practiceQuestions}
            lectureId={mistake.lecture_id}
            concept={practiceConcept}
            questionType="concept_quiz"
          />
        </div>
      )}
    </div>
  )
}

// ── Concept Group ─────────────────────────────────────────────────────────────
function ConceptGroup({ concept, mistakes, onMastered }) {
  const [collapsed, setCollapsed] = useState(false)
  const label = concept || 'General'

  return (
    <div className="concept-group">
      <button className="concept-group-header" onClick={() => setCollapsed(v => !v)}>
        <span className="concept-group-label">{label}</span>
        <span className="concept-group-count">{mistakes.length}</span>
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {!collapsed && (
        <div className="concept-group-body">
          {mistakes.map(m => (
            <MistakeCard key={m.id} mistake={m} onMastered={onMastered} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Lecture Panel (right side) ────────────────────────────────────────────────
function LectureReviewPanel({ lectureGroup, onMastered }) {
  // Group mistakes by concept
  const byConceptMap = {}
  for (const m of lectureGroup.mistakes) {
    const key = m.concept || ''
    if (!byConceptMap[key]) byConceptMap[key] = []
    byConceptMap[key].push(m)
  }
  const groups = Object.entries(byConceptMap)
    .map(([concept, mistakes]) => ({ concept: concept || null, mistakes }))

  return (
    <div className="review-lecture-panel">
      <div className="review-lecture-header">
        <BookMarked size={16} />
        <span className="review-lecture-title">{lectureGroup.lecture_title}</span>
        {lectureGroup.course_title && (
          <span className="review-course-tag">{lectureGroup.course_title}</span>
        )}
        <span className="review-mistake-count">
          {lectureGroup.mistakes.length} to review
        </span>
      </div>

      <div className="review-concepts">
        {groups.map((g, i) => (
          <ConceptGroup
            key={i}
            concept={g.concept}
            mistakes={g.mistakes}
            onMastered={onMastered}
          />
        ))}
      </div>
    </div>
  )
}

// ── Main Review Page ──────────────────────────────────────────────────────────
export default function ReviewPage() {
  const [groups, setGroups]             = useState([])
  const [loading, setLoading]           = useState(true)
  const [selectedLectureId, setSelectedLectureId] = useState(null)
  const [tutorOpen, setTutorOpen]       = useState(false)

  const fetchMistakes = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/mistakes')
      const d = await r.json()
      setGroups(d)
      // Auto-select first lecture if current selection disappears
      if (d.length > 0 && !d.find(g => g.lecture_id === selectedLectureId)) {
        setSelectedLectureId(d[0].lecture_id)
      }
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { fetchMistakes() }, [])

  const handleMastered = (mistakeId) => {
    setGroups(prev => {
      const next = prev.map(g => ({
        ...g,
        mistakes: g.mistakes.filter(m => m.id !== mistakeId),
      })).filter(g => g.mistakes.length > 0)

      // Update selection if current lecture just emptied
      const stillHasSelected = next.find(g => g.lecture_id === selectedLectureId)
      if (!stillHasSelected && next.length > 0) {
        setSelectedLectureId(next[0].lecture_id)
      } else if (next.length === 0) {
        setSelectedLectureId(null)
      }
      return next
    })
  }

  const selectedGroup = groups.find(g => g.lecture_id === selectedLectureId)
  const totalMistakes = groups.reduce((n, g) => n + g.mistakes.length, 0)

  return (
    <div className="review-page">
      {/* ── Left sidebar: lecture list ─────────────────── */}
      <aside className="review-sidebar">
        <div className="review-sidebar-header">
          <RotateCcw size={16} />
          <span>Review</span>
          {totalMistakes > 0 && (
            <span className="review-total-badge">{totalMistakes}</span>
          )}
        </div>

        {loading ? (
          <div className="review-sidebar-loading">
            <Loader size={20} className="spin" />
          </div>
        ) : groups.length === 0 ? (
          <div className="review-sidebar-empty">
            <CheckCircle size={28} className="review-all-done-icon" />
            <p>All caught up!</p>
            <span>Wrong answers will appear here as you do quizzes.</span>
          </div>
        ) : (
          <div className="review-lecture-list">
            {groups.map(g => (
              <button
                key={g.lecture_id}
                className={`review-lecture-item ${selectedLectureId === g.lecture_id ? 'active' : ''}`}
                onClick={() => { setSelectedLectureId(g.lecture_id); setTutorOpen(false) }}
              >
                <div className="review-item-info">
                  {g.course_title && (
                    <span className="review-item-course">{g.course_title}</span>
                  )}
                  <span className="review-item-title">{g.lecture_title}</span>
                </div>
                <span className="review-item-badge">{g.mistakes.length}</span>
                <ChevronRight size={14} className="review-item-arrow" />
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* ── Right panel: mistakes + tutor ─────────────── */}
      <div className="review-main">
        {!selectedGroup ? (
          <div className="review-main-empty">
            <Inbox size={48} />
            <h3>Nothing to review</h3>
            <p>
              Take quizzes in any lecture — wrong answers will appear here so you can
              revisit and master them.
            </p>
          </div>
        ) : (
          <div className="review-main-content">
            <LectureReviewPanel
              lectureGroup={selectedGroup}
              onMastered={handleMastered}
            />
          </div>
        )}

        {/* AI Tutor pinned to the bottom — loads the selected lecture's context */}
        {selectedLectureId && (
          <TutorPanel
            lectureId={selectedLectureId}
            lectureTitle={selectedGroup?.lecture_title}
            open={tutorOpen}
            onToggle={() => setTutorOpen(v => !v)}
          />
        )}
      </div>
    </div>
  )
}
