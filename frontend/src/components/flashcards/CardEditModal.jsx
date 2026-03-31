import { useState, useEffect } from 'react'
import { X, Save } from 'lucide-react'
import './Flashcards.css'

export default function CardEditModal({ card, onSave, onClose }) {
  const [front, setFront]   = useState(card.front || '')
  const [back, setBack]     = useState(card.back  || '')
  const [saving, setSaving] = useState(false)

  // Sync when a different card is passed in
  useEffect(() => {
    setFront(card.front || '')
    setBack(card.back  || '')
  }, [card.id])

  const save = async () => {
    if (!front.trim() || !back.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/flashcards/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: front.trim(), back: back.trim() }),
      })
      const updated = await res.json()
      onSave(updated)
    } catch {
      // fail silently — the card stays as-is
    } finally {
      setSaving(false)
    }
  }

  // Close on Escape
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Edit Flashcard</span>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <label className="modal-field-label">Front — Question</label>
          <textarea
            className="modal-textarea"
            value={front}
            onChange={e => setFront(e.target.value)}
            rows={3}
            placeholder="Question or prompt…"
            autoFocus
          />

          <label className="modal-field-label" style={{ marginTop: 14 }}>Back — Answer</label>
          <textarea
            className="modal-textarea"
            value={back}
            onChange={e => setBack(e.target.value)}
            rows={3}
            placeholder="Answer…"
          />
        </div>

        <div className="modal-footer">
          <button className="btn-modal-cancel" onClick={onClose}>Cancel</button>
          <button
            className="btn-modal-save"
            onClick={save}
            disabled={saving || !front.trim() || !back.trim()}
          >
            <Save size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
