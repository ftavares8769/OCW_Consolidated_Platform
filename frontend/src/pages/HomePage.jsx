import { useState, useEffect, useRef } from 'react'
import { Flame, Target, BookOpen, Pencil, Check, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import ActivityHeatmap from '../components/ActivityHeatmap.jsx'
import Confetti from '../components/Confetti.jsx'
import './HomePage.css'

// ── helpers ───────────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function todayKey()  { return new Date().toISOString().slice(0, 10) }
function thisWeekKey() {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
}

// ── GoalRing — SVG progress circle ───────────────────────────────────────────

function GoalRing({ value, goal, label, sublabel, color = '#6366f1', icon: Icon }) {
  const R    = 40
  const circ = 2 * Math.PI * R
  const pct  = Math.min(value / Math.max(goal, 1), 1)
  const offset = circ * (1 - pct)
  const done = pct >= 1

  return (
    <div className={`goal-ring-card ${done ? 'goal-done' : ''}`}>
      <div className="goal-ring-svg-wrap">
        <svg viewBox="0 0 100 100" className="goal-ring-svg">
          {/* Track */}
          <circle
            cx="50" cy="50" r={R}
            fill="none"
            stroke="var(--border)"
            strokeWidth="9"
          />
          {/* Progress */}
          <circle
            cx="50" cy="50" r={R}
            fill="none"
            stroke={done ? '#22c55e' : color}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        <div className="goal-ring-inner">
          <Icon size={16} color={done ? '#22c55e' : color} />
          <span className="goal-ring-val">{value}</span>
          <span className="goal-ring-of">/ {goal}</span>
        </div>
      </div>
      <div className="goal-ring-label">{label}</div>
      {sublabel && <div className="goal-ring-sublabel">{sublabel}</div>}
    </div>
  )
}

// ── GoalEditor — inline goal editing ─────────────────────────────────────────

function GoalEditor({ goals, onSave }) {
  const [editing, setEditing]   = useState(false)
  const [cards, setCards]       = useState(goals.daily_cards)
  const [lecs, setLecs]         = useState(goals.weekly_lectures)

  const save = async () => {
    await fetch('/api/stats/goals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_cards: Number(cards), weekly_lectures: Number(lecs) }),
    })
    onSave({ daily_cards: Number(cards), weekly_lectures: Number(lecs) })
    setEditing(false)
  }

  if (!editing) {
    return (
      <button className="btn-edit-goals" onClick={() => setEditing(true)}>
        <Pencil size={13} /> Set goals
      </button>
    )
  }

  return (
    <div className="goal-editor">
      <label className="goal-editor-row">
        <span>Daily cards</span>
        <input
          type="number" min={1} max={500}
          value={cards}
          onChange={e => setCards(e.target.value)}
          className="goal-input"
        />
      </label>
      <label className="goal-editor-row">
        <span>Weekly lectures</span>
        <input
          type="number" min={1} max={50}
          value={lecs}
          onChange={e => setLecs(e.target.value)}
          className="goal-input"
        />
      </label>
      <div className="goal-editor-actions">
        <button className="btn-goal-save" onClick={save}><Check size={13} /> Save</button>
        <button className="btn-goal-cancel" onClick={() => setEditing(false)}><X size={13} /> Cancel</button>
      </div>
    </div>
  )
}

// ── CourseProgressList ────────────────────────────────────────────────────────

function CourseProgressList({ courses }) {
  if (!courses || courses.length === 0) {
    return (
      <div className="lp-empty">
        <BookOpen size={28} />
        <p>No courses imported yet. <Link to="/discover">Discover courses →</Link></p>
      </div>
    )
  }

  return (
    <div className="cp-grid">
      {courses.map(course => {
        const pct        = course.lecture_count > 0
          ? Math.round((course.fully_done / course.lecture_count) * 100)
          : 0
        const barColor   = pct === 100 ? '#22c55e' : pct >= 50 ? '#6366f1' : '#f59e0b'
        const avgPct     = Math.round((course.avg_score / course.max_score) * 100)

        return (
          <Link key={course.id} to="/library" className="cp-card">
            <div className="cp-card-title">{course.title}</div>
            <div className="cp-stats-row">
              <span className="cp-done-label">
                {course.fully_done} / {course.lecture_count} lectures complete
              </span>
              {pct === 100 && <span className="cp-badge-done">✓ Done</span>}
            </div>
            {/* Fully-complete lectures bar */}
            <div className="cp-bar-track">
              <div className="cp-bar-fill" style={{ width: `${pct}%`, background: barColor }} />
            </div>
            {/* Average processing progress */}
            <div className="cp-avg-row">
              <span className="cp-avg-label">Avg processing</span>
              <div className="cp-bar-track cp-bar-sm">
                <div
                  className="cp-bar-fill"
                  style={{ width: `${avgPct}%`, background: 'var(--accent)', opacity: 0.5 }}
                />
              </div>
              <span className="cp-avg-val">{course.avg_score}/{course.max_score}</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

// ── Main HomePage ─────────────────────────────────────────────────────────────

export default function HomePage() {
  const [stats,   setStats]   = useState(null)
  const [goals,   setGoals]   = useState({ daily_cards: 20, weekly_lectures: 3 })
  const [confetti, setConfetti] = useState(false)
  const celebratedRef = useRef({})

  useEffect(() => {
    fetch('/api/stats/overview')
      .then(r => r.json())
      .then(data => {
        setStats(data)
        setGoals(data.goals)
        checkCelebrations(data)
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function checkCelebrations(data) {
    const dk  = `daily_${todayKey()}`
    const wk  = `weekly_${thisWeekKey()}`
    const seen = JSON.parse(localStorage.getItem('learnOCW_celebrated') || '{}')

    const dailyMet   = data.today_cards  >= data.goals.daily_cards
    const weeklyMet  = data.weekly_lectures_done >= data.goals.weekly_lectures

    if ((dailyMet && !seen[dk]) || (weeklyMet && !seen[wk])) {
      setConfetti(true)
      if (dailyMet)  seen[dk] = true
      if (weeklyMet) seen[wk] = true
      localStorage.setItem('learnOCW_celebrated', JSON.stringify(seen))
    }
  }

  const handleGoalsSave = newGoals => {
    setGoals(newGoals)
    if (stats) checkCelebrations({ ...stats, goals: newGoals })
  }

  return (
    <div className="home-page">
      <Confetti active={confetti} onDone={() => setConfetti(false)} />

      {/* ── Header ── */}
      <div className="home-header">
        <div>
          <h1 className="home-greeting">{greeting()}, learner 🎓</h1>
          <p className="home-subtitle">
            {stats?.streak > 0
              ? `You're on a ${stats.streak}-day streak — keep it up!`
              : "Let's start building your learning habit."}
          </p>
        </div>
        {stats && (
          <div className="home-streak-badge">
            <Flame size={20} color="#f97316" />
            <span className="streak-num">{stats.streak}</span>
            <span className="streak-label">day streak</span>
          </div>
        )}
      </div>

      {/* ── Goal progress rings ── */}
      <section className="home-section">
        <div className="section-header">
          <h2 className="section-title">Today's Progress</h2>
          {stats && <GoalEditor goals={goals} onSave={handleGoalsSave} />}
        </div>
        <div className="goals-row">
          <GoalRing
            value={stats?.today_cards ?? 0}
            goal={goals.daily_cards}
            label="Cards Reviewed"
            sublabel="today"
            color="#6366f1"
            icon={Target}
          />
          <GoalRing
            value={stats?.weekly_lectures_done ?? 0}
            goal={goals.weekly_lectures}
            label="Lectures Processed"
            sublabel="this week"
            color="#0ea5e9"
            icon={BookOpen}
          />
          {stats && (
            <div className="streak-card">
              <div className="streak-flame">
                <Flame size={40} color={stats.streak > 0 ? '#f97316' : 'var(--text-muted)'} />
              </div>
              <div className="streak-num-big">{stats.streak}</div>
              <div className="streak-label-big">
                {stats.streak === 1 ? 'day streak' : 'day streak'}
              </div>
              {stats.streak === 0 && (
                <div className="streak-hint">Review cards to start a streak</div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Activity heatmap ── */}
      <section className="home-section">
        <h2 className="section-title">Review Activity</h2>
        <div className="heatmap-card">
          {stats
            ? <ActivityHeatmap heatmap={stats.heatmap} />
            : <div className="home-loading">Loading…</div>
          }
        </div>
      </section>

      {/* ── Course completion ── */}
      <section className="home-section">
        <div className="section-header">
          <h2 className="section-title">Course Completion</h2>
          <span className="section-hint">5 steps per lecture: Transcript · Processed · Quiz · Problems · Flashcards</span>
        </div>
        {stats
          ? <CourseProgressList courses={stats.course_progress} />
          : <div className="home-loading">Loading…</div>
        }
      </section>
    </div>
  )
}
