/**
 * ActivityHeatmap — GitHub-style 13-week review activity grid.
 * Props:
 *   heatmap  — { "YYYY-MM-DD": count, ... }
 *   compact  — if true, renders smaller cells (for sidebar use)
 */
export default function ActivityHeatmap({ heatmap = {}, compact = false }) {
  // Build 91-day array ending today
  const today = new Date()
  const days = []
  for (let i = 90; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    days.push({ date: key, count: heatmap[key] || 0, d })
  }

  // Pad start so the first cell aligns to Sunday (getDay()=0)
  const firstDayOfWeek = days[0].d.getDay()
  const padded = [...Array(firstDayOfWeek).fill(null), ...days]

  // Split into weeks (columns of 7 days)
  const weeks = []
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7))
  }

  // Month labels (show when month changes across the week boundary)
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const monthLabels = weeks.map((week, wi) => {
    const firstReal = week.find(Boolean)
    if (!firstReal) return null
    // Show label if this is the first week or the month changed from prior week
    if (wi === 0) return MONTHS[firstReal.d.getMonth()]
    const prevWeek = weeks[wi - 1]
    const prevReal = [...prevWeek].reverse().find(Boolean)
    if (prevReal && prevReal.d.getMonth() !== firstReal.d.getMonth()) {
      return MONTHS[firstReal.d.getMonth()]
    }
    return null
  })

  const getLevel = count => {
    if (count === 0) return 0
    if (count < 5)  return 1
    if (count < 10) return 2
    if (count < 20) return 3
    return 4
  }

  const dayLabels = ['S','M','T','W','T','F','S']

  return (
    <div className={`heatmap-wrapper ${compact ? 'heatmap-compact' : ''}`}>
      {/* Month labels row */}
      <div className="heatmap-month-row">
        <div className="heatmap-day-col-spacer" />
        {weeks.map((_, wi) => (
          <div key={wi} className="heatmap-month-label">
            {monthLabels[wi] || ''}
          </div>
        ))}
      </div>

      <div className="heatmap-body">
        {/* Day-of-week labels */}
        <div className="heatmap-day-col">
          {dayLabels.map((d, i) => (
            <div key={i} className="heatmap-day-label">
              {/* Show Mon, Wed, Fri only to avoid clutter */}
              {(i === 1 || i === 3 || i === 5) ? d : ''}
            </div>
          ))}
        </div>

        {/* Cell grid */}
        <div className="heatmap-grid">
          {weeks.map((week, wi) => (
            <div key={wi} className="heatmap-week-col">
              {week.map((day, di) =>
                day ? (
                  <div
                    key={di}
                    className={`heatmap-cell heat-${getLevel(day.count)}`}
                    title={`${day.date}: ${day.count} card${day.count !== 1 ? 's' : ''} reviewed`}
                  />
                ) : (
                  <div key={di} className="heatmap-cell heat-empty" />
                )
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="heatmap-legend">
        <span className="heatmap-legend-label">Less</span>
        {[0,1,2,3,4].map(l => (
          <div key={l} className={`heatmap-cell heat-${l}`} />
        ))}
        <span className="heatmap-legend-label">More</span>
      </div>
    </div>
  )
}
