import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader, AlertCircle, FileText, Layers, FolderOpen, ChevronDown } from 'lucide-react'
import { useLecture, useCourse } from '../hooks/useApi.js'
import NotesTab from '../components/tabs/NotesTab.jsx'
import StudyTab from '../components/tabs/StudyTab.jsx'
import FilesTab from '../components/tabs/FilesTab.jsx'
import TutorPanel from '../components/TutorPanel.jsx'
import './LecturePage.css'

const TABS = [
  { id: 'notes', label: 'Notes', icon: FileText },
  { id: 'study', label: 'Study', icon: Layers },
  { id: 'files', label: 'Files', icon: FolderOpen },
]

function extractLectureNumber(title, orderIndex) {
  // Try to parse lecture number from title: "Lecture 3", "3. Title", "Lec 03", etc.
  if (title) {
    const m = title.match(/(?:lecture|lec|session|ses|class|week)\s*0*(\d+)/i)
      || title.match(/^0*(\d+)[.:]\s/)
    if (m) return parseInt(m[1], 10)
  }
  // Fall back to 1-based order index
  return (orderIndex ?? 0) + 1
}

function extractYouTubeId(url) {
  if (!url) return null
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : null
}

function YouTubePlayer({ url }) {
  const ytId = extractYouTubeId(url)

  if (!ytId) return (
    <div className="player-placeholder">
      <AlertCircle size={32} />
      <p>No video available</p>
    </div>
  )

  return (
    <div className="youtube-container">
      <iframe
        src={`https://www.youtube.com/embed/${ytId}?enablejsapi=1&origin=${window.location.origin}&rel=0&modestbranding=1`}
        title="Lecture video"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="youtube-iframe"
      />
    </div>
  )
}

function StatusBar({ status, errorMessage }) {
  const stages = ['fetching', 'cleaning', 'summarizing', 'generating_study', 'done']
  const labels = {
    fetching:          'Fetching transcript',
    cleaning:          'Cleaning',
    summarizing:       'Generating overview',
    generating_study:  'Generating quiz & problems',
    done:              'Ready',
  }
  const currentIdx = stages.indexOf(status)

  if (status === 'done' || status === 'pending') return null

  if (status === 'error') {
    return (
      <div className="status-bar status-bar-error">
        <AlertCircle size={13} />
        <span>{errorMessage || 'Generation failed — check server logs for details'}</span>
      </div>
    )
  }

  return (
    <div className="status-bar">
      <Loader size={13} className="spin" />
      <span>{labels[status] || status}…</span>
      <div className="stage-dots">
        {stages.slice(0, 4).map((s, i) => (
          <div key={s} className={`stage-dot ${i < currentIdx ? 'done' : i === currentIdx ? 'active' : ''}`} />
        ))}
      </div>
    </div>
  )
}

export default function LecturePage() {
  const { lectureId } = useParams()
  const navigate = useNavigate()
  const { lecture, loading, error, pollTimedOut, refetch } = useLecture(lectureId)
  const { course } = useCourse(lecture?.course_id)
  const [activeTab, setActiveTab] = useState('notes')
  const [tutorOpen, setTutorOpen] = useState(false)
  const [courseResources, setCourseResources] = useState([])
  const [resetting, setResetting] = useState(false)

  const resetAndRetry = async () => {
    setResetting(true)
    try {
      await fetch(`/api/lectures/${lectureId}/process?force=true`, { method: 'POST' })
      await refetch()
    } catch (e) {
      console.error('Reset failed:', e)
    } finally {
      setResetting(false)
    }
  }

  useEffect(() => {
    if (!lecture?.course_id) return
    fetch(`/api/courses/${lecture.course_id}/resources`)
      .then(r => r.json())
      .then(d => setCourseResources(d.resources || []))
      .catch(() => {})
  }, [lecture?.course_id])

  // Only block the whole page if we couldn't load the lecture at all
  if (loading && !lecture) return (
    <div className="lecture-loading">
      <Loader size={32} className="spin" />
      <p>Loading lecture…</p>
    </div>
  )

  if (error && !lecture) return (
    <div className="lecture-error">
      <AlertCircle size={32} />
      <p>Failed to load lecture: {error}</p>
      <button onClick={() => navigate(-1)} className="btn-back-err">Go back</button>
    </div>
  )

  if (!lecture) return null

  return (
    <div className="lecture-page">
      {/* Top bar */}
      <div className="lecture-topbar">
        <button className="btn-back" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="lecture-breadcrumb">
          {course && <span className="breadcrumb-course">{course.title}</span>}
          <ChevronDown size={14} className="breadcrumb-sep" style={{ transform: 'rotate(-90deg)' }} />
          <span className="breadcrumb-lecture">{lecture.title}</span>
        </div>
        <StatusBar status={lecture.status} errorMessage={lecture.error_message} />
      </div>

      {/* Inline banner when background poll timed out — page stays fully usable */}
      {pollTimedOut && (
        <div className="poll-timeout-banner">
          <AlertCircle size={14} />
          <span>
            Still <strong>{lecture.status}</strong> — local models can take 15+ minutes for a full lecture.
            Only restart if you are sure it has stopped (check server logs or Ollama).
          </span>
          <button className="poll-retry-btn" onClick={refetch}>Check status</button>
          <button className="poll-retry-btn" onClick={resetAndRetry} disabled={resetting}>
            {resetting ? 'Restarting…' : 'Force restart'}
          </button>
        </div>
      )}

      <div className="lecture-body">
        {/* Left panel: video only */}
        <div className="left-panel">
          <YouTubePlayer url={lecture.youtube_url} />
        </div>

        {/* Right panel: tabbed sidebar */}
        <div className="right-panel">
          <div className="tab-bar">
            {TABS.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>
          <div className="tab-content">
            {activeTab === 'notes' && (
              <NotesTab
                summary={lecture.summary}
                notes={lecture.study_materials?.notes}
                status={lecture.status}
              />
            )}
            {activeTab === 'study' && (
              <StudyTab
                materials={lecture.study_materials || {}}
                status={lecture.status}
                lectureId={Number(lectureId)}
              />
            )}
            {activeTab === 'files' && (
              <FilesTab
                resources={courseResources}
                currentLectureNumber={extractLectureNumber(lecture.title, lecture.order_index)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Tutor panel pinned to bottom-right */}
      <TutorPanel
        lectureId={lectureId}
        lectureTitle={lecture.title}
        open={tutorOpen}
        onToggle={() => setTutorOpen(o => !o)}
      />
    </div>
  )
}
