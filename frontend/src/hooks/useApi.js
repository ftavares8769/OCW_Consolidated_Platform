import { useState, useEffect, useCallback, useRef } from 'react'

const BASE = '/api'

async function apiFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useSearch() {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const search = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch(`/search?q=${encodeURIComponent(q)}`)
      setResults(data.results || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  return { results, loading, error, search }
}

export function useCourses() {
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchCourses = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/courses')
      setCourses(data)
    } catch (e) {
      console.error('Failed to load courses:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCourses() }, [fetchCourses])

  return { courses, loading, refetch: fetchCourses }
}

export function useImportCourse() {
  const [importing, setImporting] = useState({}) // courseUrl -> {id, status}

  const importCourse = useCallback(async (courseData) => {
    setImporting(prev => ({ ...prev, [courseData.url]: { status: 'importing' } }))
    try {
      const data = await apiFetch('/import', {
        method: 'POST',
        body: JSON.stringify(courseData)
      })
      setImporting(prev => ({ ...prev, [courseData.url]: { id: data.id, status: data.status } }))
      return data
    } catch (e) {
      setImporting(prev => ({ ...prev, [courseData.url]: { status: 'error', error: e.message } }))
      throw e
    }
  }, [])

  return { importing, importCourse }
}

export function useCourseStatus(courseId) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!courseId) return
    let active = true

    const poll = async () => {
      try {
        const data = await apiFetch(`/courses/${courseId}/status`)
        if (active) {
          setStatus(data)
          // Stop polling when done or error
          if (data.course_status === 'done' || data.course_status === 'error') {
            return
          }
        }
        if (active) setTimeout(poll, 2000)
      } catch (e) {
        if (active) setTimeout(poll, 5000)
      }
    }

    poll()
    return () => { active = false }
  }, [courseId])

  return status
}

// 60 polls × 3 s = 3 minutes before the "still running" banner appears.
// Generation for a 90-min lecture with a local model takes ~2-5 min, so this
// gives enough time for normal runs while surfacing hangs quickly.
const MAX_POLLS = 60

export function useLecture(lectureId) {
  const [lecture, setLecture] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)       // only for hard load failures
  const [pollTimedOut, setPollTimedOut] = useState(false)
  const pollCount = useRef(0)

  // Full fetch — sets loading=true, used only for initial load and manual refetch.
  // Do NOT call this from the background poll: setLoading(true) causes LecturePage
  // to unmount everything (video, tutor, tabs) on every poll tick.
  const fetchLecture = useCallback(async () => {
    if (!lectureId) return
    setLoading(true)
    try {
      const data = await apiFetch(`/lectures/${lectureId}`)
      setLecture(data)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [lectureId])

  // Silent poll — never touches loading state so the page stays mounted.
  // Poll errors are swallowed; the UI already shows the last known status.
  const pollLecture = useCallback(async () => {
    if (!lectureId) return
    try {
      const data = await apiFetch(`/lectures/${lectureId}`)
      setLecture(data)
    } catch (_) {
      // ignore transient poll failures
    }
  }, [lectureId])

  // Initial load (with spinner). Reset counters when lectureId changes.
  useEffect(() => {
    pollCount.current = 0
    setPollTimedOut(false)
    fetchLecture()
  }, [fetchLecture])

  // Background poll while processing — silent, capped at MAX_POLLS.
  // On timeout, set pollTimedOut (NOT error) so the page stays usable.
  useEffect(() => {
    if (!lecture || lecture.status === 'done' || lecture.status === 'error') return
    if (pollCount.current >= MAX_POLLS) {
      setPollTimedOut(true)
      return
    }
    let active = true
    const t = setTimeout(async () => {
      if (active) {
        pollCount.current += 1
        await pollLecture()
      }
    }, 3000)
    return () => { active = false; clearTimeout(t) }
  }, [lecture, pollLecture])

  return { lecture, loading, error, pollTimedOut, refetch: fetchLecture }
}

export function useCourse(courseId) {
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!courseId) return
    apiFetch(`/courses/${courseId}`)
      .then(setCourse)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [courseId])

  return { course, loading }
}

export { apiFetch }
