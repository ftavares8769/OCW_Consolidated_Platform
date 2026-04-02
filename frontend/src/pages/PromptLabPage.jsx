/**
 * Prompt Lab — test and compare AI generation functions across different models.
 *
 * Left panel:  function selector, transcript input, model picker, run button
 * Right panel: one result card per model with Raw / Parsed tabs + export
 */
import { useState, useEffect, useRef } from 'react'
import { Plus, X, Play, Download, FileText, ChevronDown, ChevronUp, Clock, CheckCircle, XCircle, Loader } from 'lucide-react'
import LatexText from '../components/LatexText.jsx'
import './PromptLabPage.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const FUNCTIONS = [
  { id: 'quiz',     label: 'Quiz',      desc: '5 questions — MCQ, fill-blank, open-ended', promptFile: 'quiz.txt'     },
  { id: 'problems', label: 'Problems',  desc: '4 practice problems with step solutions',   promptFile: 'problems.txt' },
  { id: 'notes',    label: 'Key Terms', desc: 'Up to 10 term — definition entries',        promptFile: 'notes.txt'    },
  { id: 'summary',  label: 'Summary',   desc: '2-3 sentence lecture overview',             promptFile: 'summary.txt'  },
]

const PROVIDER_LABELS = { local: '🖥 Local', openai: '☁ OpenAI', anthropic: '✦ Anthropic' }
const PROVIDER_COLORS = { local: '#6366f1', openai: '#10b981', anthropic: '#f59e0b' }

// ── Export helpers ────────────────────────────────────────────────────────────

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

function buildTxt(results, fnId, transcript, extraInstructions) {
  const hr   = '='.repeat(68)
  const date = new Date().toLocaleString()
  const fn   = FUNCTIONS.find(f => f.id === fnId)?.label || fnId
  const preview = transcript.slice(0, 300).replace(/\s+/g, ' ')

  const lines = [
    hr,
    'LEARNOCH PROMPT LAB — BENCHMARK EXPORT',
    `Date      : ${date}`,
    `Function  : ${fn}`,
    `Transcript: ${preview}${transcript.length > 300 ? '…' : ''}`,
    extraInstructions ? `Extra inst: ${extraInstructions.slice(0, 200)}` : '',
    hr,
    '',
  ]

  results.forEach((r, i) => {
    lines.push(
      `--- MODEL ${i + 1}: ${r.model}  [${PROVIDER_LABELS[r.provider] || r.provider}] ---`,
      `Status     : ${r.error ? 'ERROR' : 'success'}`,
      `Time       : ${r.time_s}s`,
      `Parse valid: ${r.valid ? 'yes' : 'no'}`,
      r.item_count ? `Items      : ${r.item_count}` : '',
      r.error ? `Error      : ${r.error}` : '',
      '',
      'OUTPUT:',
      r.raw || '(no output)',
      '',
    )
  })

  lines.push(
    hr,
    'SCORING GUIDE — paste this file into Claude / Gemini for external review',
    '',
    'Rate each model\'s output 1–5 on:',
    '  1. JSON validity      — did the output parse without errors?',
    '  2. Format adherence   — correct keys, field types, item count?',
    '  3. Content accuracy   — based on the transcript, no hallucinations?',
    '  4. Cognitive depth    — are questions/problems non-trivial?',
    '  5. Distractor quality — (MCQ only) are wrong answers plausible near-misses?',
    '  6. LaTeX usage        — math expressions wrapped in $…$ correctly?',
    hr,
  )

  return lines.filter(l => l !== undefined).join('\n')
}

function buildCsv(results, fnId, transcript) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = 'model,provider,function,time_s,valid,item_count,error,raw_output'
  const rows = results.map(r => [
    esc(r.model), esc(r.provider), esc(fnId),
    esc(r.time_s), esc(r.valid ? 'true' : 'false'),
    esc(r.item_count ?? 0), esc(r.error ?? ''),
    esc(r.raw ?? ''),
  ].join(','))
  return [header, ...rows].join('\n')
}

// ── Parsed output renderers ───────────────────────────────────────────────────

function ParsedQuiz({ items }) {
  if (!Array.isArray(items) || !items.length) return <span className="lab-empty">No items parsed</span>
  return (
    <div className="parsed-quiz">
      {items.map((q, i) => (
        <div key={i} className="pq-item">
          <div className="pq-header">
            <span className={`pq-type pq-type-${q.type || 'mcq'}`}>
              {q.type === 'fill_blank' ? 'Fill blank' : q.type === 'open_ended' ? 'Open' : 'MCQ'}
            </span>
            <span className="pq-num">Q{i + 1}</span>
          </div>
          <div className="pq-question"><LatexText>{q.question}</LatexText></div>
          {q.type !== 'open_ended' && q.type !== 'fill_blank' && Array.isArray(q.options) && (
            <ol className="pq-options" type="A">
              {q.options.map((opt, oi) => (
                <li key={oi} className={oi === q.correct_index ? 'pq-correct' : ''}>
                  <LatexText>{opt}</LatexText>{oi === q.correct_index ? ' ✓' : ''}
                </li>
              ))}
            </ol>
          )}
          {q.type === 'fill_blank' && (
            <div className="pq-answer">Answer: <strong><LatexText>{q.blank_answer}</LatexText></strong></div>
          )}
          {q.type === 'open_ended' && (
            <div className="pq-answer">Sample: <LatexText>{q.sample_answer}</LatexText></div>
          )}
        </div>
      ))}
    </div>
  )
}

function ParsedProblems({ items }) {
  if (!Array.isArray(items) || !items.length) return <span className="lab-empty">No items parsed</span>
  return (
    <div className="parsed-problems">
      {items.map((p, i) => (
        <div key={i} className="pp-item">
          <div className="pp-label">Problem {i + 1}</div>
          <div className="pp-problem"><LatexText block>{p.problem}</LatexText></div>
          {p.solution && (
            <div className="pp-steps">
              {String(p.solution).split('|||').map(s => s.trim()).filter(Boolean).map((s, si) => (
                <div key={si} className="pp-step"><span className="pp-step-num">{si + 1}</span><LatexText>{s}</LatexText></div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ParsedNotes({ items }) {
  if (!Array.isArray(items) || !items.length) return <span className="lab-empty">No items parsed</span>
  return (
    <dl className="parsed-notes">
      {items.map((entry, i) => {
        const s = String(entry)
        // Prefer em dash separator; fall back to first ': ' so legacy/malformed output still splits
        let term, def
        if (s.includes('—')) {
          const parts = s.split('—')
          term = parts[0]
          def  = parts.slice(1).join('—')
        } else {
          const idx = s.indexOf(': ')
          term = idx >= 0 ? s.slice(0, idx) : s
          def  = idx >= 0 ? s.slice(idx + 2) : ''
        }
        return (
          <div key={i} className="pn-entry">
            <dt><LatexText>{term.trim()}</LatexText></dt>
            <dd><LatexText>{def.trim() || s}</LatexText></dd>
          </div>
        )
      })}
    </dl>
  )
}

function ParsedOutput({ fnId, parsed }) {
  if (!parsed) return <span className="lab-empty">No parsed output</span>
  if (fnId === 'quiz')     return <ParsedQuiz items={parsed} />
  if (fnId === 'problems') return <ParsedProblems items={parsed} />
  if (fnId === 'notes')    return <ParsedNotes items={parsed} />
  return <div className="parsed-text"><LatexText block>{String(parsed)}</LatexText></div>
}

// ── Model Picker ──────────────────────────────────────────────────────────────

function ModelPicker({ available, selected, onAdd, onClose }) {
  const [custom, setCustom] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const handle = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  const add = (provider, model) => {
    const key = `${provider}:${model}`
    if (!selected.some(s => `${s.provider}:${s.model}` === key)) {
      onAdd({ provider, model })
    }
    onClose()
  }

  const addCustomLocal = () => {
    if (custom.trim()) { add('local', custom.trim()); setCustom('') }
  }

  return (
    <div className="model-picker" ref={ref}>
      {/* Local Ollama models */}
      <div className="picker-section">
        <div className="picker-section-label">🖥 Local (Ollama)</div>
        {available.local.length === 0
          ? <div className="picker-empty">No Ollama models found</div>
          : available.local.map(m => (
            <button key={m} className="picker-item" onClick={() => add('local', m)}>{m}</button>
          ))
        }
        <div className="picker-custom-row">
          <input
            className="picker-custom-input"
            placeholder="custom model name…"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCustomLocal()}
          />
          <button className="picker-custom-add" onClick={addCustomLocal}>Add</button>
        </div>
      </div>

      {/* OpenAI */}
      <div className="picker-section">
        <div className="picker-section-label">
          ☁ OpenAI
          {!available.configured?.openai_key && <span className="picker-no-key"> (no key)</span>}
        </div>
        {available.openai.map(m => (
          <button
            key={m} className="picker-item"
            disabled={!available.configured?.openai_key}
            onClick={() => add('openai', m)}
          >{m}</button>
        ))}
      </div>

      {/* Anthropic */}
      <div className="picker-section">
        <div className="picker-section-label">
          ✦ Anthropic
          {!available.configured?.anthropic_key && <span className="picker-no-key"> (no key)</span>}
        </div>
        {available.anthropic.map(m => (
          <button
            key={m} className="picker-item"
            disabled={!available.configured?.anthropic_key}
            onClick={() => add('anthropic', m)}
          >{m}</button>
        ))}
      </div>
    </div>
  )
}

// ── Result Card ───────────────────────────────────────────────────────────────

function ResultCard({ result, fnId }) {
  const [tab, setTab] = useState('raw')

  const status = result.status   // 'idle' | 'running' | 'done' | 'error'
  const color  = PROVIDER_COLORS[result.provider] || '#888'

  return (
    <div className={`result-card result-${status}`}>
      {/* Card header */}
      <div className="result-header">
        <div className="result-model-info">
          <span className="result-provider-badge" style={{ borderColor: color, color }}>
            {PROVIDER_LABELS[result.provider] || result.provider}
          </span>
          <span className="result-model-name">{result.model}</span>
        </div>
        <div className="result-meta">
          {status === 'running' && <Loader size={14} className="spin" />}
          {status === 'done'    && <CheckCircle size={14} color="#22c55e" />}
          {status === 'error'   && <XCircle size={14} color="#ef4444" />}
          {result.time_s > 0   && (
            <span className="result-time"><Clock size={11} /> {result.time_s}s</span>
          )}
          {status === 'done' && (
            <span className={`result-valid ${result.valid ? 'valid-ok' : 'valid-bad'}`}>
              {result.valid ? `✓ ${result.item_count} item${result.item_count !== 1 ? 's' : ''}` : '✗ parse fail'}
            </span>
          )}
        </div>
      </div>

      {/* Error message */}
      {result.error && (
        <div className="result-error">{result.error}</div>
      )}

      {/* Tab switcher */}
      {status === 'done' && !result.error && (
        <>
          <div className="result-tabs">
            <button className={`result-tab ${tab === 'raw' ? 'active' : ''}`} onClick={() => setTab('raw')}>Raw</button>
            <button className={`result-tab ${tab === 'parsed' ? 'active' : ''}`} onClick={() => setTab('parsed')}>Parsed</button>
          </div>
          <div className="result-content">
            {tab === 'raw'
              ? <pre className="result-raw">{result.raw || '(empty)'}</pre>
              : <ParsedOutput fnId={fnId} parsed={result.parsed} />
            }
          </div>
        </>
      )}

      {status === 'running' && (
        <div className="result-running-msg">Generating…</div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PromptLabPage() {
  const [available,    setAvailable]    = useState({ local: [], openai: [], anthropic: [], configured: {} })
  const [selectedFn,   setSelectedFn]   = useState('quiz')
  const [transcript,   setTranscript]   = useState('')
  const [extra,        setExtra]        = useState('')
  const [showExtra,    setShowExtra]    = useState(false)
  const [selectedModels, setSelectedModels] = useState([])
  const [showPicker,      setShowPicker]      = useState(false)
  const [results,         setResults]         = useState([])
  const [running,         setRunning]         = useState(false)

  // ── Lecture picker state ──────────────────────────────────────────────────
  const [showLecturePicker, setShowLecturePicker] = useState(false)
  const [pickerCourses,     setPickerCourses]     = useState([])
  const [pickerCourseId,    setPickerCourseId]    = useState('')
  const [pickerLectures,    setPickerLectures]    = useState([])
  const [pickerLectureId,   setPickerLectureId]   = useState('')
  const [loadingLecture,    setLoadingLecture]    = useState(false)
  const [loadedTitle,       setLoadedTitle]       = useState('')

  useEffect(() => {
    fetch('/api/lab/models')
      .then(r => r.json())
      .then(setAvailable)
      .catch(() => {})
  }, [])

  // Fetch courses once when lecture picker opens
  useEffect(() => {
    if (!showLecturePicker || pickerCourses.length > 0) return
    fetch('/api/courses')
      .then(r => r.json())
      .then(data => setPickerCourses(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [showLecturePicker])

  // Fetch lectures when a course is selected; only show fully transcribed ones
  useEffect(() => {
    if (!pickerCourseId) { setPickerLectures([]); setPickerLectureId(''); return }
    fetch(`/api/courses/${pickerCourseId}`)
      .then(r => r.json())
      .then(data => setPickerLectures((data.lectures || []).filter(l => l.status === 'done')))
      .catch(() => {})
  }, [pickerCourseId])

  const addModel = m => setSelectedModels(prev => [...prev, m])
  const removeModel = i => setSelectedModels(prev => prev.filter((_, pi) => pi !== i))

  const loadLectureTranscript = async () => {
    if (!pickerLectureId) return
    setLoadingLecture(true)
    try {
      const data = await fetch(`/api/lectures/${pickerLectureId}`).then(r => r.json())
      const text = data.transcript_clean || data.transcript_raw || ''
      setTranscript(text)
      setLoadedTitle(data.title || '')
      setShowLecturePicker(false)
      setPickerCourseId('')
      setPickerLectureId('')
      setPickerLectures([])
    } catch (_) { /* silently ignore network errors */ }
    setLoadingLecture(false)
  }

  const canRun = !running && transcript.trim().length > 50 && selectedModels.length > 0

  const runAll = async () => {
    if (!canRun) return
    setRunning(true)

    // Initialise result slots with 'running' status
    const initial = selectedModels.map(m => ({ ...m, status: 'running', raw: '', parsed: null, valid: false, item_count: 0, time_s: 0, error: null }))
    setResults(initial)

    // Fire all requests concurrently; update each slot as it resolves
    await Promise.all(
      selectedModels.map(async (m, i) => {
        try {
          const res = await fetch('/api/lab/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transcript,
              function: selectedFn,
              provider: m.provider,
              model:    m.model,
              extra_instructions: extra,
            }),
          })
          const data = await res.json()
          setResults(prev => prev.map((r, ri) =>
            ri === i ? { ...r, ...data, status: data.error ? 'error' : 'done' } : r
          ))
        } catch (err) {
          setResults(prev => prev.map((r, ri) =>
            ri === i ? { ...r, status: 'error', error: String(err) } : r
          ))
        }
      })
    )

    setRunning(false)
  }

  const hasDoneResults = results.some(r => r.status === 'done' || r.status === 'error')
  const stamp = () => new Date().toISOString().slice(0, 10)

  return (
    <div className="lab-page">
      {/* ── Left config panel ── */}
      <div className="lab-config">
        <div className="lab-config-header">
          <span className="lab-title">🧪 Prompt Lab</span>
        </div>

        {/* Function selector */}
        <div className="lab-section">
          <div className="lab-label">Function</div>
          <div className="lab-fn-grid">
            {FUNCTIONS.map(f => (
              <button
                key={f.id}
                className={`lab-fn-btn ${selectedFn === f.id ? 'active' : ''}`}
                onClick={() => setSelectedFn(f.id)}
                title={f.desc}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="lab-fn-desc">
            {FUNCTIONS.find(f => f.id === selectedFn)?.desc}
            <span className="lab-fn-file"> · {FUNCTIONS.find(f => f.id === selectedFn)?.promptFile}</span>
          </div>
          <div className="lab-fn-chunk-note">
            ⚙ Long transcripts (&gt;3000 words) are first chunked and summarised via <code>chunk.txt</code> before this prompt runs.
          </div>
        </div>

        {/* Transcript */}
        <div className="lab-section lab-section-grow">
          <div className="lab-label">
            Transcript / Content
            <span className="lab-char-count">{transcript.length} chars</span>
            <button
              className="lab-from-lecture-btn"
              onClick={() => setShowLecturePicker(v => !v)}
            >
              {showLecturePicker ? 'Cancel' : 'Load from lecture'}
            </button>
          </div>

          {showLecturePicker && (
            <div className="lab-lecture-picker">
              <select
                className="lab-picker-select"
                value={pickerCourseId}
                onChange={e => setPickerCourseId(e.target.value)}
              >
                <option value="">{pickerCourses.length ? 'Select course…' : 'Loading courses…'}</option>
                {pickerCourses.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>

              {pickerCourseId && (
                <select
                  className="lab-picker-select"
                  value={pickerLectureId}
                  onChange={e => setPickerLectureId(e.target.value)}
                >
                  <option value="">{pickerLectures.length ? 'Select lecture…' : 'No transcribed lectures'}</option>
                  {pickerLectures.map(l => (
                    <option key={l.id} value={l.id}>{l.title}</option>
                  ))}
                </select>
              )}

              <button
                className="lab-picker-load-btn"
                disabled={!pickerLectureId || loadingLecture}
                onClick={loadLectureTranscript}
              >
                {loadingLecture ? 'Loading…' : 'Load transcript'}
              </button>
            </div>
          )}

          {loadedTitle && (
            <div className="lab-loaded-badge">
              📄 {loadedTitle}
              <button
                className="lab-loaded-clear"
                onClick={() => { setTranscript(''); setLoadedTitle('') }}
                title="Clear"
              >×</button>
            </div>
          )}

          <textarea
            className="lab-textarea"
            placeholder="Paste a lecture transcript or any text here (min ~50 chars)…"
            value={transcript}
            onChange={e => { setTranscript(e.target.value); if (loadedTitle) setLoadedTitle('') }}
          />
        </div>

        {/* Extra instructions (collapsible) */}
        <div className="lab-section">
          <button className="lab-collapse-btn" onClick={() => setShowExtra(v => !v)}>
            Extra instructions
            {showExtra ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {showExtra && (
            <textarea
              className="lab-textarea lab-textarea-sm"
              placeholder="Append custom instructions to the system prompt for this run…"
              value={extra}
              onChange={e => setExtra(e.target.value)}
            />
          )}
        </div>

        {/* Model list */}
        <div className="lab-section">
          <div className="lab-label">Models to test</div>
          <div className="lab-model-list">
            {selectedModels.map((m, i) => (
              <div key={i} className="lab-model-chip"
                style={{ borderColor: PROVIDER_COLORS[m.provider] }}>
                <span className="chip-provider" style={{ color: PROVIDER_COLORS[m.provider] }}>
                  {PROVIDER_LABELS[m.provider]}
                </span>
                <span className="chip-name">{m.model}</span>
                <button className="chip-remove" onClick={() => removeModel(i)}>
                  <X size={11} />
                </button>
              </div>
            ))}

            <div className="lab-picker-wrap">
              <button className="btn-add-model" onClick={() => setShowPicker(v => !v)}>
                <Plus size={13} /> Add model
              </button>
              {showPicker && (
                <ModelPicker
                  available={available}
                  selected={selectedModels}
                  onAdd={addModel}
                  onClose={() => setShowPicker(false)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Run button */}
        <button className="btn-run-all" onClick={runAll} disabled={!canRun}>
          <Play size={15} />
          {running ? 'Running…' : `Run All (${selectedModels.length} model${selectedModels.length !== 1 ? 's' : ''})`}
        </button>

        {!transcript.trim().length && (
          <div className="lab-hint">Paste a transcript to get started.</div>
        )}
        {transcript.trim().length > 0 && transcript.trim().length < 50 && (
          <div className="lab-hint">Transcript too short (need at least 50 chars).</div>
        )}
      </div>

      {/* ── Right results panel ── */}
      <div className="lab-results">
        {/* Export bar */}
        <div className="lab-export-bar">
          <span className="lab-results-title">
            {results.length > 0
              ? `Results — ${FUNCTIONS.find(f => f.id === selectedFn)?.label}`
              : 'Results will appear here'}
          </span>
          <div className="lab-export-btns">
            <button
              className="btn-export"
              disabled={!hasDoneResults}
              onClick={() => triggerDownload(
                buildTxt(results, selectedFn, transcript, extra),
                `promptlab_${selectedFn}_${stamp()}.txt`,
                'text/plain'
              )}
            >
              <FileText size={13} /> Export .txt
            </button>
            <button
              className="btn-export"
              disabled={!hasDoneResults}
              onClick={() => triggerDownload(
                buildCsv(results, selectedFn, transcript),
                `promptlab_${selectedFn}_${stamp()}.csv`,
                'text/csv'
              )}
            >
              <Download size={13} /> Export .csv
            </button>
          </div>
        </div>

        {/* Result cards */}
        {results.length === 0 ? (
          <div className="lab-empty-state">
            <div className="lab-empty-icon">🧪</div>
            <p>Select a function, paste a transcript, add models, then click <strong>Run All</strong>.</p>
            <p className="lab-empty-sub">Results from all models will appear here side-by-side for easy comparison.</p>
          </div>
        ) : (
          <div className="lab-results-grid" style={{ gridTemplateColumns: `repeat(${Math.min(results.length, 3)}, 1fr)` }}>
            {results.map((r, i) => (
              <ResultCard key={i} result={r} fnId={selectedFn} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
