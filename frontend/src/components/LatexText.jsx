/**
 * LatexText — renders text that may contain LaTeX math.
 * Supported delimiters:
 *   $$...$$    display math
 *   \[...\]    display math  (common model output)
 *   $...$      inline math
 *   \(...\)    inline math   (common model output)
 *
 * Uses KaTeX directly — compatible with any React element including
 * <button>, <span>, etc.
 *
 * Props:
 *   children  — the text to render (string)
 *   block     — if true renders as <div>, otherwise <span>; default false
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

// Split text into alternating text / math segments.
// Ordered so display variants are matched before inline variants.
//   Group 1: $$...$$   display
//   Group 2: \[...\]   display
//   Group 3: \(...\)   inline
//   Group 4: $...$     inline  (newlines forbidden to avoid false positives)
function parseLatex(str) {
  const parts = []
  const regex = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\((.+?)\\\)|\$([^$\n]+?)\$/g
  let last = 0
  let m
  while ((m = regex.exec(str)) !== null) {
    if (m.index > last) {
      parts.push({ type: 'text', value: str.slice(last, m.index) })
    }
    if (m[1] !== undefined) {
      parts.push({ type: 'display', value: m[1] })   // $$...$$
    } else if (m[2] !== undefined) {
      parts.push({ type: 'display', value: m[2] })   // \[...\]
    } else if (m[3] !== undefined) {
      parts.push({ type: 'inline', value: m[3] })    // \(...\)
    } else {
      parts.push({ type: 'inline', value: m[4] })    // $...$
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
