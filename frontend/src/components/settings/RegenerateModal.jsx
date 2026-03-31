import { useState, useEffect, useCallback } from 'react'
import {
  X, ChevronDown, ChevronRight, CheckSquare, Square, Minus,
  Loader, Check, AlertCircle, RotateCcw, BookOpen, Layers,
} from 'lucide-react'
import './RegenerateModal.css'

// ── Content type definitions ──────────────────────────────────────────────────
const CONTENT_TYPES = [
  {
    id:    'study_materials',
    label: 'Study Materials',
    icon:  BookOpen,
    desc:  'Summary, notes, quiz, practice problems',
  },
  {
    id:    'flashcards',
    label: 'Flashcards',
    icon:  Layers,
    desc:  'Spaced-repetition card decks',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True if a lecture has content for a given type, given the enabledTypes set */
function lectureHasType(lec, typeId) {
  if (typeId === 'flashcards')      return lec.flashcard_count > 0
  if (typeId === 'study_materials') return lec.has_summary || lec.material_types?.length > 0
  return false
}

/** Human-readable badge text for a type on a lecture */
function typeBadge(lec, typeId) {
  if (typeId === 'flashcards') {
    return `${lec.flashcard_count} card${lec.flashcard_count !== 1 ? 's' : ''}`
  }
  if (typeId === 'study_materials') {
    const parts = []
    if (lec.has_summary)               parts.push('summary')
    if (lec.material_types?.includes('quiz'))     parts.push('quiz')
    if (lec.material_types?.includes('problems')) parts.push('problems')
    if (lec.material_types?.includes('notes'))    parts.push('notes')
    return parts.join(' · ') || 'materials'
  }
  return ''
}

/** Reason a lecture can't have its study materials regenerated */
function studyMatsBlockedReason(lec) {
  if (!lec.has_transcript) return 'no transcript'
  return null
}

// ── Status dot / icon for a single type cell ─────────────────────────────────
function TypeStatus({ status, count, error }) {
  if (!status || status === 'idle') return null
  if (status === 'running') return (
    <span className="regen-type-status running">
      <Loader size={11} className="regen-spin" /> Regenerating…
    </span>
  )
  if (status === 'done') return (
    <span className="regen-type-status done">
      <Check size={11} /> {count != null ? `${count} cards` : 'Done'}
    </span>
  )
  if (status === 'error') return (
    <span className="regen-type-status error" title={error}>
      <AlertCircle size={11} /> Failed
    </span>
  )
  if (status === 'skipped') return (
    <span className="regen-type-status skipped">—</span>
  )
  return null
}

// ── Lecture row ───────────────────────────────────────────────────────────────
function LectureRow({ lec, checked, onToggle, enabledTypes, progress, isActive }) {
  return (
    <div className={`regen-lecture-row ${isActive ? 'is-active' : ''}`}>
      {/* Checkbox — hidden during/after run */}
      {isActive ? (
        <span className="regen-check-placeholder" />
      ) : (
        <button
          className={`regen-checkbox ${checked ? 'checked' : ''}`}
          onClick={() => onToggle(lec.lecture_id)}
          role="checkbox"
          aria-checked={checked}
        >
          {checked ? <CheckSquare size={15} /> : <Square size={15} />}
        </button>
      )}

      {/* Title */}
      <span className="regen-lec-title">{lec.lecture_title}</span>

      {/* Per-type badges / status */}
      <div className="regen-type-cells">
        {CONTENT_TYPES.map(ct => {
          if (!enabledTypes.has(ct.id)) return null
          const hasIt    = lectureHasType(lec, ct.id)
          const blocked  = ct.id === 'study_materials' ? studyMatsBlockedReason(lec) : null
          const p        = progress[lec.lecture_id]?.[ct.id]

          if (p) return (
            <div key={ct.id} className="regen-type-cell">
              <TypeStatus status={p.status} count={p.count} error={p.error} />
            </div>
          )

          if (blocked) return (
            <div key={ct.id} className="regen-type-cell">
              <span className="regen-type-badge disabled" title={blocked}>
                {ct.label} · {blocked}
              </span>
            </div>
          )

          if (!hasIt) return (
            <div key={ct.id} className="regen-type-cell">
              <span className="regen-type-badge none">no {ct.label.toLowerCase()}</span>
            </div>
          )

          return (
            <div key={ct.id} className="regen-type-cell">
              <span className="regen-type-badge has">{typeBadge(lec, ct.id)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Course group ──────────────────────────────────────────────────────────────
function CourseGroup({ course, selected, onToggleLecture, onToggleCourse, enabledTypes, progress, isActive }) {
  const [open, setOpen] = useState(true)

  // Only include lectures that have at least one enabled type
  const relevantLectures = course.lectures.filter(lec =>
    [...enabledTypes].some(t => {
      if (t === 'study_materials') {
        return (lec.has_summary || lec.material_types?.length > 0) && lec.has_transcript
      }
      return lectureHasType(lec, t)
    })
  )
  if (relevantLectures.length === 0) return null

  const allChecked  = relevantLectures.every(l => selected.has(l.lecture_id))
  const someChecked = relevantLectures.some(l => selected.has(l.lecture_id))

  return (
    <div className="regen-course-group">
      <div className="regen-course-header">
        {!isActive && (
          <button
            className={`regen-checkbox course-check ${allChecked ? 'checked' : ''}`}
            onClick={() => onToggleCourse(course.course_id, relevantLectures, !allChecked)}
            role="checkbox"
            aria-checked={allChecked}
          >
            {allChecked  ? <CheckSquare size={15} /> :
             someChecked ? <Minus size={15} className="partial" /> :
                           <Square size={15} />}
          </button>
        )}
        <button className="regen-course-toggle" onClick={() => setOpen(o => !o)}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="regen-course-title">{course.course_title}</span>
          <span className="regen-course-count">{relevantLectures.length} lecture{relevantLectures.length !== 1 ? 's' : ''}</span>
        </button>
      </div>

      {open && (
        <div className="regen-lectures">
          {relevantLectures.map(lec => (
            <LectureRow
              key={lec.lecture_id}
              lec={lec}
              checked={selected.has(lec.lecture_id)}
              onToggle={onToggleLecture}
              enabledTypes={enabledTypes}
              progress={progress}
              isActive={isActive}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function RegenerateModal({ prevModel, newModel, onClose }) {
  const [phase, setPhase]         = useState('loading')  // loading | select | running | done
  const [courses, setCourses]     = useState([])
  const [selected, setSelected]   = useState(new Set())  // lecture_id set
  const [enabledTypes, setEnabledTypes] = useState(new Set(['study_materials', 'flashcards']))
  const [progress, setProgress]   = useState({})         // {lectureId: {study_materials?: {...}, flashcards?: {...}}}
  const [doneCount, setDoneCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)

  // Load all lectures with AI content
  useEffect(() => {
    fetch('/api/lectures/regenerable')
      .then(r => r.json())
      .then(data => {
        setCourses(data)
        // Pre-select all selectable lectures
        const all = new Set()
        data.forEach(c => c.lectures.forEach(l => {
          // Only pre-select if they have something regenerable
          const hasStudy = (l.has_summary || l.material_types?.length > 0) && l.has_transcript
          const hasFC    = l.flashcard_count > 0
          if (hasStudy || hasFC) all.add(l.lecture_id)
        }))
        setSelected(all)
        setPhase(data.length === 0 ? 'empty' : 'select')
      })
      .catch(() => setPhase('select'))
  }, [])

  const allLectures = courses.flatMap(c => c.lectures)

  // Count how many lectures are selected and have something to do for enabled types
  const actionCount = [...selected].filter(id => {
    const lec = allLectures.find(l => l.lecture_id === id)
    if (!lec) return false
    return [...enabledTypes].some(t => {
      if (t === 'flashcards')      return lec.flashcard_count > 0
      if (t === 'study_materials') return (lec.has_summary || lec.material_types?.length > 0) && lec.has_transcript
      return false
    })
  }).length

  const toggleType = (typeId) => {
    setEnabledTypes(prev => {
      const next = new Set(prev)
      next.has(typeId) ? next.delete(typeId) : next.add(typeId)
      return next
    })
  }

  const toggleLecture = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleCourse = useCallback((courseId, lecList, check) => {
    setSelected(prev => {
      const next = new Set(prev)
      lecList.forEach(l => check ? next.add(l.lecture_id) : next.delete(l.lecture_id))
      return next
    })
  }, [])

  const selectAll = () => {
    const all = new Set()
    courses.forEach(c => c.lectures.forEach(l => all.add(l.lecture_id)))
    setSelected(all)
  }
  const deselectAll = () => setSelected(new Set())

  // ── Regeneration ────────────────────────────────────────────────────────────
  const runRegenerate = async () => {
    setPhase('running')
    const toRegen = allLectures.filter(l => selected.has(l.lecture_id))
    let done = 0, errors = 0

    for (const lec of toRegen) {
      const id = lec.lecture_id

      // ── Study materials ────────────────────────────────────────
      if (
        enabledTypes.has('study_materials') &&
        (lec.has_summary || lec.material_types?.length > 0) &&
        lec.has_transcript
      ) {
        setProgress(prev => ({
          ...prev,
          [id]: { ...prev[id], study_materials: { status: 'running' } },
        }))
        try {
          const res = await fetch(`/api/lectures/${id}/regenerate-materials`, { method: 'POST' })
          if (!res.ok) {
            const err = await res.json()
            throw new Error(err.detail || 'Regeneration failed')
          }
          setProgress(prev => ({
            ...prev,
            [id]: { ...prev[id], study_materials: { status: 'done' } },
          }))
          done++
          setDoneCount(done)
        } catch (e) {
          setProgress(prev => ({
            ...prev,
            [id]: { ...prev[id], study_materials: { status: 'error', error: e.message } },
          }))
          errors++
          setErrorCount(errors)
        }
      }

      // ── Flashcards ─────────────────────────────────────────────
      if (enabledTypes.has('flashcards') && lec.flashcard_count > 0) {
        setProgress(prev => ({
          ...prev,
          [id]: { ...prev[id], flashcards: { status: 'running' } },
        }))
        try {
          await fetch(`/api/flashcards/lecture/${id}`, { method: 'DELETE' })
          const res = await fetch(`/api/flashcards/generate/${id}`, { method: 'POST' })
          if (!res.ok) {
            const err = await res.json()
            throw new Error(err.detail || 'Generation failed')
          }
          const data = await res.json()
          setProgress(prev => ({
            ...prev,
            [id]: { ...prev[id], flashcards: { status: 'done', count: data.cards_created } },
          }))
          done++
          setDoneCount(done)
        } catch (e) {
          setProgress(prev => ({
            ...prev,
            [id]: { ...prev[id], flashcards: { status: 'error', error: e.message } },
          }))
          errors++
          setErrorCount(errors)
        }
      }
    }

    setPhase('done')
  }

  const isActive = phase === 'running' || phase === 'done'

  // ── Column headers based on enabled types ──────────────────────────────────
  const activeTypeCount = enabledTypes.size

  return (
    <div
      className="regen-overlay"
      onClick={e => e.target === e.currentTarget && phase !== 'running' && onClose()}
    >
      <div className="regen-modal">

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="regen-header">
          <div className="regen-header-icon">
            <RotateCcw size={18} />
          </div>
          <div className="regen-header-text">
            <h2 className="regen-title">Regenerate AI Content</h2>
            <p className="regen-subtitle">
              Model changed: <code>{prevModel}</code> → <code>{newModel}</code>
            </p>
          </div>
          {phase !== 'running' && (
            <button className="regen-close" onClick={onClose}><X size={16} /></button>
          )}
        </div>

        {/* ── Type toggles ────────────────────────────────────────── */}
        {(phase === 'select' || isActive) && (
          <div className="regen-type-bar">
            <span className="regen-type-bar-label">Regenerate:</span>
            {CONTENT_TYPES.map(ct => {
              const Icon = ct.icon
              const on   = enabledTypes.has(ct.id)
              return (
                <button
                  key={ct.id}
                  className={`regen-type-toggle ${on ? 'on' : ''}`}
                  onClick={() => phase === 'select' && toggleType(ct.id)}
                  disabled={phase !== 'select'}
                  title={ct.desc}
                >
                  <Icon size={13} />
                  {ct.label}
                  {on && phase === 'select' && <span className="regen-toggle-check"><Check size={10} /></span>}
                </button>
              )
            })}
          </div>
        )}

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="regen-body">
          {phase === 'loading' && (
            <div className="regen-loading">
              <Loader size={18} className="spin" /> Loading your content…
            </div>
          )}

          {phase === 'empty' && (
            <div className="regen-loading">
              <p>No AI-generated content found — nothing to regenerate.</p>
            </div>
          )}

          {(phase === 'select' || isActive) && (
            <>
              {/* Toolbar */}
              {phase === 'select' && (
                <div className="regen-toolbar">
                  <span className="regen-toolbar-label">
                    {actionCount} lecture{actionCount !== 1 ? 's' : ''} selected
                  </span>
                  <button className="regen-link-btn" onClick={selectAll}>Select all</button>
                  <span className="regen-dot">·</span>
                  <button className="regen-link-btn" onClick={deselectAll}>Deselect all</button>
                </div>
              )}

              {/* Done summary */}
              {phase === 'done' && (
                <div className="regen-summary-banner">
                  <Check size={14} />
                  {doneCount} operation{doneCount !== 1 ? 's' : ''} completed
                  {errorCount > 0 && <span className="regen-err-note">, {errorCount} failed</span>}
                </div>
              )}

              {/* Column headers (only when types bar is relevant) */}
              {enabledTypes.size > 0 && (
                <div className="regen-col-headers">
                  <span className="regen-col-lec">Lecture</span>
                  {CONTENT_TYPES.map(ct =>
                    enabledTypes.has(ct.id)
                      ? <span key={ct.id} className="regen-col-type">{ct.label}</span>
                      : null
                  )}
                </div>
              )}

              {/* Course + lecture tree */}
              <div className="regen-deck-list">
                {courses.map(course => (
                  <CourseGroup
                    key={course.course_id}
                    course={course}
                    selected={selected}
                    onToggleLecture={toggleLecture}
                    onToggleCourse={toggleCourse}
                    enabledTypes={enabledTypes}
                    progress={progress}
                    isActive={isActive}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div className="regen-footer">
          {phase === 'select' && (
            <>
              <button className="regen-btn-skip" onClick={onClose}>Skip for now</button>
              <button
                className="regen-btn-run"
                onClick={runRegenerate}
                disabled={actionCount === 0 || enabledTypes.size === 0}
              >
                <RotateCcw size={14} />
                Regenerate {actionCount > 0 ? `${actionCount} lecture${actionCount !== 1 ? 's' : ''}` : ''}
              </button>
            </>
          )}

          {phase === 'running' && (
            <span className="regen-running-label">
              <Loader size={13} className="regen-spin" />
              Regenerating — please don't close this window…
            </span>
          )}

          {(phase === 'done' || phase === 'empty') && (
            <button className="regen-btn-run" onClick={onClose}>
              <Check size={14} /> Done
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
