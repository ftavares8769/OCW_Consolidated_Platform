/**
 * LatexText — renders text that may contain LaTeX math ($...$ inline, $$...$$ display).
 * Uses katex directly (no react-markdown) so it works in any context including
 * <button> and <span> elements, and is compatible with React 18.
 *
 * Props:
 *   children  — the text to render (string)
 *   block     — if true renders as a <div>, otherwise <span>; default false
 *   className — optional CSS class on the wrapper element
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'

function renderMath(tex, displayMode) {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false })
  } catch {
    return tex
  }
}

// Split text into alternating text / math segments
function parseLatex(str) {
  const parts = []
  // Match $$...$$ (display) before $...$ (inline) to avoid ambiguity
  const regex = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
  let last = 0
  let m
  while ((m = regex.exec(str)) !== null) {
    if (m.index > last) {
      parts.push({ type: 'text', value: str.slice(last, m.index) })
    }
    if (m[1] !== undefined) {
      parts.push({ type: 'display', value: m[1] })
    } else {
      parts.push({ type: 'inline', value: m[2] })
    }
    last = m.index + m[0].length
  }
  if (last < str.length) {
    parts.push({ type: 'text', value: str.slice(last) })
  }
  return parts
}

export default function LatexText({ children, block = false, className }) {
  if (children === null || children === undefined) return null
  const text = String(children)
  if (!text) return null

  const parts = parseLatex(text)
  const Tag = block ? 'div' : 'span'

  return (
    <Tag className={className}>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return <span key={i}>{part.value}</span>
        }
        const html = renderMath(part.value, part.type === 'display')
        return (
          <span
            key={i}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      })}
    </Tag>
  )
}
