import { FolderOpen, Download, ExternalLink, FileText } from 'lucide-react'
import './Tab.css'

const TYPE_LABELS = {
  problem_set: 'Problem Set',
  exam: 'Exam',
  slides: 'Slides',
  pdf: 'PDF',
  reading: 'Reading',
  other: 'File'
}

const TYPE_COLORS = {
  problem_set: '#f5a623',
  exam: '#e05c6e',
  slides: '#6c8ef5',
  pdf: '#4caf8c',
}

export default function ResourcesTab({ resources }) {
  if (!resources || resources.length === 0) {
    return (
      <div className="tab-empty">
        <FolderOpen size={32} />
        <p>No additional resources</p>
      </div>
    )
  }

  return (
    <div className="tab-body">
      <p className="tab-count">{resources.length} file{resources.length !== 1 ? 's' : ''}</p>
      {resources.map(r => (
        <div key={r.id} className="resource-row">
          <div className="resource-row-left">
            <FileText size={14} style={{ color: TYPE_COLORS[r.type] || 'var(--text-muted)' }} />
            <div>
              <div className="resource-title">{r.title}</div>
              <span className="resource-type-badge" style={{ color: TYPE_COLORS[r.type] || 'var(--text-muted)' }}>
                {TYPE_LABELS[r.type] || r.type}
              </span>
            </div>
          </div>
          <div className="resource-actions">
            {r.has_local ? (
              <a href={`/api/resources/${r.id}/file`} download className="res-btn download-btn">
                <Download size={13} /> Download
              </a>
            ) : r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer" className="res-btn ext-btn">
                <ExternalLink size={13} /> Open
              </a>
            ) : (
              <span className="res-unavailable">Not found</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
