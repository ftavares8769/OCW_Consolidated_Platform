/**
 * Confetti — burst of colored particles for goal celebrations.
 * Props:
 *   active   — boolean; triggers the animation when it flips to true
 *   onDone   — called after animation completes (~3.5 s)
 */
import { useEffect, useState } from 'react'
import './Confetti.css'

const COLORS = [
  '#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3',
  '#54a0ff', '#5f27cd', '#00d2d3', '#1dd1a1',
]

export default function Confetti({ active, onDone }) {
  const [particles, setParticles] = useState([])

  useEffect(() => {
    if (!active) return

    const ps = Array.from({ length: 70 }, (_, i) => ({
      id:       i,
      x:        Math.random() * 100,          // % from left
      color:    COLORS[Math.floor(Math.random() * COLORS.length)],
      size:     5 + Math.random() * 8,        // px
      delay:    Math.random() * 0.6,          // s
      duration: 2.2 + Math.random() * 1.6,   // s
      rotEnd:   Math.round(Math.random() * 720 - 360), // deg
      shape:    Math.random() > 0.5 ? 'square' : 'circle',
    }))
    setParticles(ps)

    const timer = setTimeout(() => {
      setParticles([])
      onDone?.()
    }, 3800)

    return () => clearTimeout(timer)
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  if (particles.length === 0) return null

  return (
    <div className="confetti-container" aria-hidden="true">
      {particles.map(p => (
        <div
          key={p.id}
          className="confetti-particle"
          style={{
            left:              `${p.x}%`,
            width:             p.size,
            height:            p.size,
            background:        p.color,
            borderRadius:      p.shape === 'circle' ? '50%' : '2px',
            animationDelay:    `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--rot-end':       `${p.rotEnd}deg`,
          }}
        />
      ))}
    </div>
  )
}
