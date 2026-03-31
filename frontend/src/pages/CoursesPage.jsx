import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, BookOpen, Download, CheckCircle, Loader, AlertCircle, Trash2, ExternalLink, ChevronRight, Calendar, RefreshCw, PlayCircle, ShieldCheck, HelpCircle } from 'lucide-react'
import { useSearch, useCourses, useImportCourse } from '../hooks/useApi.js'
import './CoursesPage.css'

function CourseCard({ course, onOpen, onDelete, onRescan }) {
  return (
    <div className="course-card fade-in">
      <div className="course-card-header">
        <div className="course-meta">
          {course.course_number && <span className="course-number">{course.course_number}</span>}
          {course.subject && <span className="course-subject">{course.subject}</span>}
        </div>
        <div className="course-actions">
          <a href={course.ocw_url} target="_blank" rel="noreferrer" className="icon-btn" title="Open on OCW">
            <ExternalLink size={14} />
          </a>
          <button className="icon-btn" onClick={() => onRescan(course.id)} title="Re-scan for videos">
            <RefreshCw size={14} />
          </button>
          <button className="icon-btn danger" onClick={() => onDelete(course.id)} title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <h3 className="course-title" onClick={() => onOpen(course)}>{course.title}</h3>
      {course.description && <p className="course-desc">{course.description.slice(0, 160)}{course.description.length > 160 ? '…' : ''}</p>}
      <div className="course-card-footer">
        <span className={`status-badge ${course.status}`}>
          {course.status === 'importing' ? <><Loader size={12} className="spin" /> Importing…</> :
           course.status === 'done' ? <><CheckCircle size={12} /> {course.lecture_count} lectures</> :
           course.status === 'error' ? <><AlertCircle size={12} /> Error</> : null}
        </span>
        {course.status === 'done' && course.lecture_count > 0 && (
          <button className="btn-open" onClick={() => onOpen(course)}>
            Open <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

function ConfidenceBadge({ confidence }) {
  if (confidence === 'verified') {
    return <span className="confidence-badge verified"><ShieldCheck size={11} /> Verified</span>
  }
  return <span className="confidence-badge possible"><HelpCircle size={11} /> Possible match</span>
}

function SearchResult({ result, onImport, isImporting, alreadyImported }) {
  return (
    <div className="search-result playlist-card fade-in">
      {result.thumbnail && (
        <div className="playlist-thumb-wrap">
          <img className="playlist-thumb" src={result.thumbnail} alt="" loading="lazy" />
          <span className="playlist-count"><PlayCircle size={12} /> {result.video_count} videos</span>
        </div>
      )}
      <div className="playlist-body">
        <div className="search-result-meta">
          {result.course_number && <span className="course-number">{result.course_number}</span>}
          {result.subject && <span className="course-subject">{result.subject}</span>}
          {result.term && <span className="course-term"><Calendar size={10} /> {result.term}</span>}
          <ConfidenceBadge confidence={result.confidence} />
        </div>
        <h4 className="search-result-title">{result.playlist_title}</h4>
        {result.title && result.title !== result.playlist_title && (
          <p className="ocw-match-label">
            <ExternalLink size={11} />
            OCW: {result.title}
          </p>
        )}
        <div className="search-result-footer">
          <a href={result.url} target="_blank" rel="noreferrer" className="result-link">
            <ExternalLink size={12} /> OCW Page
          </a>
          <a href={result.playlist_url} target="_blank" rel="noreferrer" className="result-link">
            <PlayCircle size={12} /> Playlist
          </a>
          {alreadyImported ? (
            <span className="status-badge done"><CheckCircle size={12} /> Added</span>
          ) : isImporting ? (
            <span className="status-badge importing"><Loader size={12} className="spin" /> Adding…</span>
          ) : (
            <button className="btn-import" onClick={() => onImport(result)}>
              <Download size={13} /> Add to Library
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CourseExpanded({ course, onClose, onDelete }) {
  const navigate = useNavigate()
  const [lectureStatuses, setLectureStatuses] = useState({})
  const lectures = course.lectures || []

  const handleDownload = useCallback(async (lectureId) => {
    setLectureStatuses(s => ({ ...s, [lectureId]: 'fetching' }))
    try {
      const res = await fetch(`/api/lectures/${lectureId}/process`, { method: 'POST' })
      const data = await res.json()
      setLectureStatuses(s => ({ ...s, [lectureId]: data.status }))

      // Poll until done
      const poll = async () => {
        const r = await fetch(`/api/lectures/${lectureId}/status`)
        const d = await r.json()
        setLectureStatuses(s => ({ ...s, [lectureId]: d.status }))
        if (!['done', 'error'].includes(d.status)) {
          setTimeout(poll, 2500)
        }
      }
      setTimeout(poll, 2500)
    } catch {
      setLectureStatuses(s => ({ ...s, [lectureId]: 'error' }))
    }
  }, [])

  const getStatus = (lec) => lectureStatuses[lec.id] ?? lec.status

  return (
    <div className="course-expanded fade-in">
      <div className="expanded-header">
        <div>
          <div className="expanded-meta">
            {course.course_number && <span className="course-number">{course.course_number}</span>}
            {course.subject && <span className="course-subject">{course.subject}</span>}
          </div>
          <h2>{course.title}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn danger" onClick={() => { onDelete(course.id); onClose() }} title="Delete course">
            <Trash2 size={14} />
          </button>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
      {course.description && <p className="expanded-desc">{course.description}</p>}
      <div className="lectures-list">
        <h3 className="lectures-heading">{lectures.length} Lectures</h3>
        {lectures.length === 0 && (
          <p className="no-lectures">No lecture videos found for this course.</p>
        )}
        {lectures.map((lec, i) => {
          const status = getStatus(lec)
          const isProcessing = ['fetching', 'cleaning', 'summarizing'].includes(status)
          const isDone = status === 'done'
          return (
            <div key={lec.id} className="lecture-item">
              <span className="lec-num">{i + 1}</span>
              <span className="lec-title" onClick={() => navigate(`/lecture/${lec.id}`)} style={{ cursor: 'pointer' }}>
                {lec.title}
              </span>
              <div className="lec-actions">
                {isDone ? (
                  <span className="lec-status done"><CheckCircle size={13} /></span>
                ) : isProcessing ? (
                  <span className="lec-status processing">
                    <Loader size={13} className="spin" /> {status}
                  </span>
                ) : status === 'error' ? (
                  <span className="lec-status error"><AlertCircle size={13} /></span>
                ) : (
                  <button className="btn-download-lec" onClick={() => handleDownload(lec.id)}>
                    <Download size={13} /> Download
                  </button>
                )}
                <button className="icon-btn" onClick={() => navigate(`/lecture/${lec.id}`)} title="Open lecture">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Library Page ────────────────────────────────────────────────────────────
export function LibraryPage() {
  const { courses, loading, refetch } = useCourses()
  const [expandedCourse, setExpandedCourse] = useState(null)

  const handleOpen = useCallback(async (course) => {
    const full = await fetch(`/api/courses/${course.id}`).then(r => r.json())
    setExpandedCourse(full)
  }, [])

  const handleDelete = useCallback(async (courseId) => {
    if (!confirm('Delete this course and all its data?')) return
    await fetch(`/api/courses/${courseId}`, { method: 'DELETE' })
    refetch()
    if (expandedCourse?.id === courseId) setExpandedCourse(null)
  }, [expandedCourse, refetch])

  const handleRescan = useCallback(async (courseId) => {
    await fetch(`/api/courses/${courseId}/rescan`, { method: 'POST' })
    refetch()
    // Poll until done
    const poll = async () => {
      const r = await fetch(`/api/courses/${courseId}/status`)
      const d = await r.json()
      refetch()
      if (d.course_status === 'importing') setTimeout(poll, 2000)
    }
    setTimeout(poll, 2000)
  }, [refetch])

  // Split: courses with videos vs without
  const withVideos = courses.filter(c => c.lecture_count > 0 || c.status === 'importing')
  const withoutVideos = courses.filter(c => c.lecture_count === 0 && c.status !== 'importing')

  return (
    <div className="courses-page">
      <div className="page-header">
        <h1 className="page-title">My Library</h1>
      </div>
      <div className="courses-body">
        {expandedCourse ? (
          <CourseExpanded
            course={expandedCourse}
            onClose={() => setExpandedCourse(null)}
            onDelete={handleDelete}
          />
        ) : loading ? (
          <div className="loading-state"><Loader size={24} className="spin" /></div>
        ) : courses.length === 0 ? (
          <div className="empty-state">
            <BookOpen size={48} />
            <h3>No courses yet</h3>
            <p>Go to Discover to find and import courses</p>
          </div>
        ) : (
          <>
            {withVideos.length > 0 && (
              <>
                <p className="tab-count">{withVideos.length} course{withVideos.length !== 1 ? 's' : ''} with videos</p>
                <div className="courses-grid">
                  {withVideos.map(c => (
                    <CourseCard key={c.id} course={c} onOpen={handleOpen} onDelete={handleDelete} onRescan={handleRescan} />
                  ))}
                </div>
              </>
            )}
            {withoutVideos.length > 0 && (
              <details className="no-video-section">
                <summary className="no-video-summary">
                  <span>{withoutVideos.length} course{withoutVideos.length !== 1 ? 's' : ''} without video lectures</span>
                </summary>
                <div className="courses-grid" style={{ marginTop: 12 }}>
                  {withoutVideos.map(c => (
                    <CourseCard key={c.id} course={c} onOpen={handleOpen} onDelete={handleDelete} onRescan={handleRescan} />
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Discover Page ───────────────────────────────────────────────────────────
export default function DiscoverPage() {
  const { results, loading: searchLoading, error: searchError, search } = useSearch()
  const { courses, refetch } = useCourses()
  const { importing, importCourse } = useImportCourse()
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState(false)
  const debounceRef = useRef(null)

  const importedUrls = new Set(courses.map(c => c.ocw_url))
  const importedPlaylists = new Set(courses.map(c => c.playlist_id).filter(Boolean))

  const handleSearch = useCallback((val) => {
    setQuery(val)
    clearTimeout(debounceRef.current)
    if (val.trim().length < 2) { setSearched(false); return }
    debounceRef.current = setTimeout(async () => {
      setSearched(true)
      await search(val)
    }, 500)
  }, [search])

  const handleImport = useCallback(async (result) => {
    try {
      await importCourse({
        url: result.url,
        title: result.playlist_title || result.title,
        subject: result.subject || '',
        course_number: result.course_number || '',
        description: result.description || '',
        playlist_id: result.playlist_id || null,
      })
      refetch()
    } catch (e) {
      console.error('Import failed:', e)
    }
  }, [importCourse, refetch])

  return (
    <div className="courses-page">
      <div className="page-header">
        <h1 className="page-title">Discover Courses</h1>
        <div className="search-container">
          <div className="search-box">
            {searchLoading ? <Loader size={18} className="search-icon spin" /> : <Search size={18} className="search-icon" />}
            <input
              className="search-input"
              type="text"
              placeholder="Search MIT OpenCourseWare…"
              value={query}
              onChange={e => handleSearch(e.target.value)}
              autoFocus
            />
          </div>
          {searchError && <p className="search-error"><AlertCircle size={14} /> {searchError}</p>}
        </div>
      </div>
      <div className="courses-body">
        {results.length > 0 ? (
          <div className="results-section">
            <p className="tab-count">{results.length} results for "{query}"</p>
            <div className="results-grid">
              {results.map((r, i) => (
                <SearchResult
                  key={i}
                  result={r}
                  onImport={handleImport}
                  isImporting={importing[r.url]?.status === 'importing'}
                  alreadyImported={importedUrls.has(r.url) || (r.playlist_id && importedPlaylists.has(r.playlist_id))}
                />
              ))}
            </div>
          </div>
        ) : searched && !searchLoading ? (
          <div className="empty-state">
            <Search size={40} />
            <p>No results for "{query}"</p>
          </div>
        ) : !searched ? (
          <div className="empty-state">
            <Search size={48} />
            <h3>Search MIT OpenCourseWare</h3>
            <p>2,500+ courses available — type to search</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
