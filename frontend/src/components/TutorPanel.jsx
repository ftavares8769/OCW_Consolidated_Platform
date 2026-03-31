import { useState, useEffect, useRef } from 'react'
import { MessageSquare, X, Send, ChevronDown, Bot, User, Loader, AlertCircle } from 'lucide-react'
import LatexText from './LatexText.jsx'
import './TutorPanel.css'

/**
 * Lightweight markdown renderer for chat messages.
 * Handles **bold**, *italic*, `code`, code blocks, lists, and LaTeX via LatexText.
 */
function MessageContent({ content }) {
  if (!content) return null

  // Split into code-block segments first
  const codeBlockRegex = /```[\s\S]*?```/g
  const segments = []
  let last = 0
  let m
  const regex = new RegExp(codeBlockRegex.source, 'g')
  while ((m = regex.exec(content)) !== null) {
    if (m.index > last) segments.push({ type: 'text', value: content.slice(last, m.index) })
    const inner = m[0].slice(3, -3).replace(/^\w+\n/, '') // strip language tag
    segments.push({ type: 'code', value: inner })
    last = m.index + m[0].length
  }
  if (last < content.length) segments.push({ type: 'text', value: content.slice(last) })

  return (
    <>
      {segments.map((seg, si) => {
        if (seg.type === 'code') {
          return <pre key={si} className="md-code-block"><code>{seg.value}</code></pre>
        }
        // Render text: split by newline, handle list items and inline formatting
        const lines = seg.value.split('\n')
        return lines.map((line, li) => {
          const trimmed = line.trimStart()
          const isListItem = /^[-*•]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)
          const lineContent = isListItem
            ? trimmed.replace(/^[-*•]\s/, '').replace(/^\d+\.\s/, '')
            : line

          // Inline: bold, italic, inline-code then LaTeX
          const rendered = renderInline(lineContent)

          if (isListItem) {
            return <li key={`${si}-${li}`} className="md-item">{rendered}</li>
          }
          if (trimmed === '' && li < lines.length - 1) {
            return <br key={`${si}-${li}`} />
          }
          return <span key={`${si}-${li}`} className="md-para">{rendered}</span>
        })
      })}
    </>
  )
}

function renderInline(text) {
  // Split by inline code first
  const parts = []
  const codeRe = /`([^`]+)`/g
  let last = 0
  let m
  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) })
    parts.push({ type: 'code', value: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })

  return parts.map((p, i) => {
    if (p.type === 'code') return <code key={i} className="md-code-inline">{p.value}</code>
    // Bold + italic via simple replacement
    const html = p.value
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
    if (html !== p.value) {
      // Has markdown — use dangerouslySetInnerHTML for bold/italic only, wrap in LatexText for math
      return <LatexText key={i}>{p.value.replace(/\*+(.+?)\*+/g, '$1')}</LatexText>
    }
    return <LatexText key={i}>{p.value}</LatexText>
  })
}

export default function TutorPanel({ lectureId, lectureTitle, open, onToggle }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [context, setContext] = useState('')
  const [tutorAvailable, setTutorAvailable] = useState(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Fetch tutor context and availability
  useEffect(() => {
    if (!lectureId) return
    fetch(`/api/lectures/${lectureId}/tutor-context`)
      .then(r => r.json())
      .then(d => setContext(d.context || ''))
      .catch(() => {})

    fetch('/api/tutor/status')
      .then(r => r.json())
      .then(d => setTutorAvailable(d.available))
      .catch(() => setTutorAvailable(false))
  }, [lectureId])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const resp = await fetch('/api/tutor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          system_context: context,
          history: messages.slice(-6)
        })
      })

      if (!resp.ok) throw new Error('Tutor request failed')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''
      const assistantMsg = { role: 'assistant', content: '' }
      setMessages(msgs => [...msgs, assistantMsg])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.token) {
              assistantText += data.token
              setMessages(msgs => {
                const updated = [...msgs]
                updated[updated.length - 1] = { role: 'assistant', content: assistantText }
                return updated
              })
            }
            if (data.done) break
          } catch { }
        }
      }
    } catch (e) {
      setMessages(msgs => [...msgs, {
        role: 'assistant',
        content: `Error: ${e.message || 'Could not reach tutor'}`,
        error: true
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className={`tutor-panel ${open ? 'open' : ''}`}>
      {/* Toggle button */}
      <button className="tutor-toggle" onClick={onToggle}>
        <MessageSquare size={18} />
        <span>AI Tutor</span>
        {tutorAvailable === false && <AlertCircle size={13} className="tutor-warn" />}
        {open ? <ChevronDown size={14} /> : <ChevronDown size={14} style={{ transform: 'rotate(180deg)' }} />}
      </button>

      {/* Chat body */}
      {open && (
        <div className="tutor-body fade-in">
          <div className="tutor-header">
            <div className="tutor-header-left">
              <Bot size={16} />
              <span>Tutor — {lectureTitle || 'Lecture'}</span>
            </div>
            <button className="tutor-close" onClick={onToggle}><X size={14} /></button>
          </div>

          {tutorAvailable === false && (
            <div className="tutor-warn-banner">
              <AlertCircle size={13} />
              Ollama not detected. Start Ollama with "ollama serve" to use the tutor.
            </div>
          )}

          <div className="tutor-messages">
            {messages.length === 0 && (
              <div className="tutor-welcome">
                <Bot size={28} />
                <p>Ask me anything about this lecture!</p>
                <p className="tutor-sub">I have context from the lecture summary.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`chat-msg ${msg.role} ${msg.error ? 'error' : ''}`}>
                <div className="msg-icon">
                  {msg.role === 'user' ? <User size={13} /> : <Bot size={13} />}
                </div>
                <div className="msg-content">
                  <MessageContent content={msg.content} />
                </div>
              </div>
            ))}
            {loading && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="chat-msg assistant">
                <div className="msg-icon"><Bot size={13} /></div>
                <div className="msg-content typing">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="tutor-input-row">
            <textarea
              ref={inputRef}
              className="tutor-input"
              placeholder="Ask about this lecture…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              disabled={loading}
            />
            <button
              className="tutor-send"
              onClick={sendMessage}
              disabled={!input.trim() || loading}
            >
              {loading ? <Loader size={15} className="spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
