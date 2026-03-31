import { Loader, FileText } from 'lucide-react'
import './TranscriptPanel.css'

export default function TranscriptPanel({ text, status }) {
  if (status === 'fetching' || status === 'cleaning') {
    return (
      <div className="transcript-loading">
        <Loader size={20} className="spin" />
        <span>{status === 'fetching' ? 'Fetching transcript…' : 'Cleaning transcript…'}</span>
      </div>
    )
  }

  if (!text) {
    return (
      <div className="transcript-empty">
        <FileText size={28} />
        <p>{status === 'done' ? 'No transcript available for this video.' : 'Transcript will appear here.'}</p>
      </div>
    )
  }

  // Split into paragraphs for readability
  const paragraphs = text.split(/(?<=[.!?])\s+(?=[A-Z])/).reduce((acc, sentence, i) => {
    const paraIdx = Math.floor(i / 5)
    if (!acc[paraIdx]) acc[paraIdx] = []
    acc[paraIdx].push(sentence)
    return acc
  }, [])

  return (
    <div className="transcript-scroll">
      {paragraphs.map((para, i) => (
        <p key={i} className="transcript-para">{para.join(' ')}</p>
      ))}
    </div>
  )
}
