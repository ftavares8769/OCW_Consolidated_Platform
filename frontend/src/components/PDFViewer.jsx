import { useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader } from 'lucide-react'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import './PDFViewer.css'

// Use local worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export default function PDFViewer({ src }) {
  const [numPages, setNumPages] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1.0)
  const [error, setError] = useState(null)

  if (!src) return null

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button className="pdf-btn" onClick={() => setPageNumber(p => Math.max(1, p - 1))} disabled={pageNumber <= 1}>
          <ChevronLeft size={14} />
        </button>
        <span className="pdf-page-info">{pageNumber} / {numPages || '?'}</span>
        <button className="pdf-btn" onClick={() => setPageNumber(p => Math.min(numPages || p, p + 1))} disabled={pageNumber >= (numPages || 1)}>
          <ChevronRight size={14} />
        </button>
        <div className="pdf-zoom">
          <button className="pdf-btn" onClick={() => setScale(s => Math.max(0.5, s - 0.2))}>
            <ZoomOut size={14} />
          </button>
          <span className="pdf-scale">{Math.round(scale * 100)}%</span>
          <button className="pdf-btn" onClick={() => setScale(s => Math.min(2.5, s + 0.2))}>
            <ZoomIn size={14} />
          </button>
        </div>
      </div>
      <div className="pdf-document">
        {error ? (
          <div className="pdf-error">
            <p>Could not load PDF.</p>
            <a href={src} target="_blank" rel="noreferrer">Open in browser</a>
          </div>
        ) : (
          <Document
            file={src}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            onLoadError={e => setError(e.message)}
            loading={<div className="pdf-loading"><Loader size={20} className="spin" /></div>}
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer={true}
              renderAnnotationLayer={false}
            />
          </Document>
        )}
      </div>
    </div>
  )
}
