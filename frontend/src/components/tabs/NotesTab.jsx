import { FileText, Loader } from 'lucide-react'
import LatexText from '../LatexText.jsx'
import './Tab.css'

function NoteItem({ text }) {
  // Strip leading dash/bullet before rendering so LatexText doesn't see it
  const clean = text.replace(/^[-•]\s*/, '').trim()
  return <li><LatexText>{clean}</LatexText></li>
}

export default function NotesTab({ summary, notes, status }) {
  const isGeneratingOverview = status && !['generating_study', 'done', 'error', 'pending'].includes(status)
  const isGeneratingStudy    = status === 'generating_study'
  const hasContent = summary || (Array.isArray(notes) ? notes.length > 0 : notes)

  if (isGeneratingOverview && !hasContent) {
    return (
      <div className="tab-empty">
        <Loader size={28} className="spin" />
        <p>Generating overview…</p>
        <span className="tab-hint">This may take a minute or two</span>
      </div>
    )
  }

  if (!hasContent) {
    return (
      <div className="tab-empty">
        <FileText size={32} />
        <p>No notes yet</p>
        <span className="tab-hint">Click "Download" on the lecture to generate AI summary and notes</span>
      </div>
    )
  }

  const noteItems = Array.isArray(notes)
    ? notes
    : typeof notes === 'string'
      ? notes.split('\n').filter(l => l.trim())
      : []

  return (
    <div className="tab-body notes-tab">
      {summary && (
        <section className="notes-section">
          <h4 className="notes-section-title">Overview</h4>
          <div className="notes-text">
            <LatexText block>{summary}</LatexText>
          </div>
        </section>
      )}
      {noteItems.length > 0 && (
        <section className="notes-section">
          <h4 className="notes-section-title">Key Terms &amp; Definitions</h4>
          <ul className="notes-bullet-list">
            {noteItems.map((n, i) => <NoteItem key={i} text={n} />)}
          </ul>
        </section>
      )}
      {isGeneratingStudy && (
        <section className="notes-section notes-generating-hint">
          <Loader size={12} className="spin" style={{ marginRight: 6 }} />
          <span>Generating quiz &amp; practice problems…</span>
        </section>
      )}
    </div>
  )
}
