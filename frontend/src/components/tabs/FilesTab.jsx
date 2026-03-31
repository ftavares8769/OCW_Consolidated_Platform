import { FolderOpen, Download, ExternalLink, FileText, Star } from 'lucide-react'
import './Tab.css'

const TYPE_META = {
  slides:        { label: 'Slides',       color: '#9b6cf5' },
  lecture_notes: { label: 'Notes',        color: '#6c8ef5' },
  problem_set:   { label: 'Problem Set',  color: '#f5a623' },
  exam:          { label: 'Exam',         color: '#e05c6e' },
  textbook:      { label: 'Textbook',     color: '#4caf8c' },
  reading:       { label: 'Reading',      color: '#4caf8c' },
  resource:      { label: 'Resource',     color: '#888'    },
}

const TYPE_ORDER = ['slides', 'lecture_notes', 'reading', 'textbook', 'problem_set', 'exam', 'resource']

function typeMeta(type) {
  return TYPE_META[type] || { label: type || 'File', color: '#888' }
}

function sortResources(resources, currentLectureNumber) {
  return [...resources].sort((a, b) => {
    const aRec = a.lecture_number === currentLectureNumber
    const bRec = b.lecture_number === currentLectureNumber
    if (aRec && !bRec) return -1
    if (!aRec && bRec) return 1
    // Then by type order
    const ai = TYPE_ORDER.indexOf(a.type ?? 'resource')
    const bi = TYPE_ORDER.indexOf(b.type ?? 'resource')
    if (ai !== bi) return ai - bi
    // Then by lecture_number
    return (a.lecture_number ?? 999) - (b.lecture_number ?? 999)
  })
}

function ResourceRow({ resource, isRecommended }) {
  const meta = typeMeta(resource.type)
  const isSection = !resource.url?.match(/\.(pdf|zip|pptx|xlsx|docx)(\?|$)/i)

  return (
    <div className={`resource-row file-row ${isRecommended ? 'recommended' : ''}`}>
      <div className="resource-row-left">
        <FileText size={13} style={{ color: meta.color, flexShrink: 0 }} />
        <div className="file-info">
          <span className="resource-title">{resource.title}</span>
          <div className="file-tags">
            <span className="file-type-tag" style={{ color: meta.color, borderColor: meta.color + '55' }}>
              {meta.label}
            </span>
            {isRecommended && (
              <span className="recommended-tag">
                <Star size={9} /> Recommended
              </span>
            )}
            {isSection && (
              <span className="section-tag">OCW Section</span>
            )}
          </div>
        </div>
      </div>
      <div className="resource-actions">
        {resource.has_local ? (
          <a href={`/api/resources/${resource.id}/file`} download className="res-btn download-btn" title="Download">
            <Download size={12} />
          </a>
        ) : resource.url ? (
          <a href={resource.url} target="_blank" rel="noreferrer" className="res-btn ext-btn" title="Open">
            <ExternalLink size={12} />
          </a>
        ) : null}
      </div>
    </div>
  )
}

export default function FilesTab({ resources, currentLectureNumber }) {
  if (!resources || resources.length === 0) {
    return (
      <div className="tab-empty">
        <FolderOpen size={32} />
        <p>No course files found</p>
        <span className="tab-hint">Files are scraped when a course is added. Re-scan to refresh.</span>
      </div>
    )
  }

  const sorted = sortResources(resources, currentLectureNumber)
  const recommended = sorted.filter(r => r.lecture_number === currentLectureNumber)
  const others = sorted.filter(r => r.lecture_number !== currentLectureNumber)

  return (
    <div className="tab-body files-tab">
      <p className="tab-count">{resources.length} file{resources.length !== 1 ? 's' : ''}</p>

      {recommended.length > 0 && (
        <section className="files-group">
          <h4 className="files-group-title recommended-heading">
            <Star size={11} /> For this lecture
          </h4>
          {recommended.map(r => (
            <ResourceRow key={r.id} resource={r} isRecommended />
          ))}
        </section>
      )}

      {others.length > 0 && (
        <section className="files-group">
          {recommended.length > 0 && (
            <h4 className="files-group-title">All files</h4>
          )}
          {others.map(r => (
            <ResourceRow key={r.id} resource={r} isRecommended={false} />
          ))}
        </section>
      )}
    </div>
  )
}
