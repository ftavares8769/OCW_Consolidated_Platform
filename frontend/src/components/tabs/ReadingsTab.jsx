import { useState } from 'react'
import { BookOpen, ExternalLink, Download, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import PDFViewer from '../PDFViewer.jsx'
import './Tab.css'

function ReadingItem({ resource }) {
  const [expanded, setExpanded] = useState(false)

  const canInline = resource.has_local || (resource.url && resource.url.endsWith('.pdf'))

  return (
    <div className="reading-item">
      <div className="reading-header" onClick={() => canInline && setExpanded(e => !e)}>
        <BookOpen size={14} className="reading-icon" />
        <div className="reading-info">
          <span className="resource-title">{resource.title}</span>
          {resource.status === 'not_found' && (
            <span className="reading-badge not-found"><AlertCircle size={10} /> Not found</span>
          )}
          {resource.status === 'done' && resource.url && (
            <span className="reading-badge found">Found</span>
          )}
        </div>
        <div className="resource-actions" onClick={e => e.stopPropagation()}>
          {resource.url && (
            <a href={resource.url} target="_blank" rel="noreferrer" className="res-btn">
              <ExternalLink size={13} />
            </a>
          )}
          {resource.has_local && (
            <a href={`/api/resources/${resource.id}/file`} download className="res-btn">
              <Download size={13} />
            </a>
          )}
        </div>
        {canInline && (
          <button className="expand-btn">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      {expanded && canInline && (
        <PDFViewer src={resource.has_local ? `/api/resources/${resource.id}/file` : resource.url} />
      )}
    </div>
  )
}

export default function ReadingsTab({ resources }) {
  if (!resources || resources.length === 0) {
    return (
      <div className="tab-empty">
        <BookOpen size={32} />
        <p>No readings for this lecture</p>
      </div>
    )
  }

  return (
    <div className="tab-body">
      <p className="tab-count">{resources.length} reading{resources.length !== 1 ? 's' : ''}</p>
      {resources.map(r => (
        <ReadingItem key={r.id} resource={r} />
      ))}
    </div>
  )
}
