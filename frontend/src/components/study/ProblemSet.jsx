import { useState } from 'react'
import { ChevronDown, ChevronUp, BookOpen, CheckSquare, Square } from 'lucide-react'
import LatexText from '../LatexText.jsx'
import './Study.css'

function Problem({ problem, index, selectMode, selected, onToggleSelect }) {
  const [showSolution, setShowSolution] = useState(false)

  // Solutions stored as "Step 1 | Step 2 | Step 3" — split and render each
  const steps = typeof problem.solution === 'string'
    ? problem.solution.split('|').map(s => s.trim()).filter(Boolean)
    : []

  return (
    <div
      className={`problem-card fade-in ${selectMode ? 'selectable' : ''} ${selected ? 'problem-selected' : ''}`}
      onClick={selectMode ? () => onToggleSelect(index) : undefined}
    >
      <div className="problem-header">
        <span className="problem-num">Problem {index + 1}</span>
        {selectMode && (
          <span className="problem-select-icon">
            {selected
              ? <CheckSquare size={16} color="var(--accent)" />
              : <Square size={16} color="var(--text-muted)" />
            }
          </span>
        )}
      </div>
      <div className="problem-statement">
        <LatexText block>{problem.problem}</LatexText>
      </div>
      {!selectMode && (
        <>
          <button
            className={`solution-toggle ${showSolution ? 'open' : ''}`}
            onClick={() => setShowSolution(s => !s)}
          >
            {showSolution ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showSolution ? 'Hide solution' : 'Show solution'}
          </button>
          {showSolution && (
            <div className="solution-body fade-in">
              <div className="solution-label">Solution</div>
              {steps.length > 1 ? (
                <ol className="solution-steps">
                  {steps.map((step, i) => (
                    <li key={i}><LatexText>{step}</LatexText></li>
                  ))}
                </ol>
              ) : (
                <div className="solution-text">
                  <LatexText block>{problem.solution}</LatexText>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function ProblemSet({
  problems,
  extraProblems = [],
  selectMode = false,
  selectedIndices = new Set(),
  onToggleSelect,
}) {
  if (!problems || problems.length === 0) {
    return (
      <div className="study-empty">
        <BookOpen size={28} />
        <p>No practice problems generated</p>
      </div>
    )
  }

  return (
    <div className="problems-container">
      {selectMode && (
        <div className="problem-select-hint">
          Click problems to select them, then click "Generate Similar"
        </div>
      )}
      {problems.map((p, i) => (
        <Problem
          key={i}
          problem={p}
          index={i}
          selectMode={selectMode}
          selected={selectedIndices.has(i)}
          onToggleSelect={onToggleSelect}
        />
      ))}

      {/* Extra generated problems section */}
      {extraProblems.length > 0 && (
        <>
          <div className="extra-problems-divider">
            <span>Generated Problems</span>
          </div>
          {extraProblems.map((p, i) => (
            <Problem
              key={`extra-${i}`}
              problem={p}
              index={problems.length + i}
              selectMode={false}
              selected={false}
              onToggleSelect={null}
            />
          ))}
        </>
      )}
    </div>
  )
}
