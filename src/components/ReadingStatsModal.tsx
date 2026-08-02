import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, BookOpen, Clock, Flame, Hash } from 'lucide-react'
import { useReaderStore } from '../store/useReaderStore'

interface Props {
  open: boolean
  onClose: () => void
}

/** Heatmap reading stats modal — shows daily reading activity as a
 *  GitHub-style heatmap grid, plus streaks and total page counts. */
export default function ReadingStatsModal({ open, onClose }: Props) {
  const readingTimeAcc = useReaderStore((s) => s.readingTimeAcc)
  const pagesReadTotal = useReaderStore((s) => s.pagesReadTotal)

  // Build 12-week (84-day) heatmap from today backward
  const heatmapData = useMemo(() => {
    const data: Array<{ date: string; day: string; minutes: number; level: number }> = []
    const now = new Date()

    for (let i = 83; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const minutes = readingTimeAcc[key] || 0
      // Map minutes to level 0-4 for heatmap coloring
      const level = minutes === 0 ? 0 : minutes <= 5 ? 1 : minutes <= 15 ? 2 : minutes <= 45 ? 3 : 4
      data.push({
        date: key,
        day: d.toLocaleDateString('en', { weekday: 'short' }),
        minutes,
        level,
      })
    }
    return data
  }, [readingTimeAcc])

  // Compute streak (consecutive days with reading)
  const streak = useMemo(() => {
    let count = 0
    const now = new Date()
    for (let i = 0; i < 84; i++) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (readingTimeAcc[key] && readingTimeAcc[key] > 0) count++
      else if (i > 0) break // Break on first gap (skip today since day may not be over)
    }
    return count
  }, [readingTimeAcc])

  // Total minutes read
  const totalMinutes = useMemo(() =>
    Object.values(readingTimeAcc).reduce((sum, v) => sum + v, 0),
  [readingTimeAcc])

  // Level colors: 0=empty, 1=low, 2=med, 3=high, 4=intense
  const levelColors = [
    'bg-white/[0.03]',
    'bg-emerald-500/20',
    'bg-emerald-500/35',
    'bg-emerald-500/55',
    'bg-emerald-500/80',
  ]

  // Days of week labels (Mon-Sun)
  const dayLabels = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[580px] bg-[#0a0a0a]/98 border border-white/[0.06] rounded-2xl shadow-lg shadow-black/50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
              <h3 className="text-sm font-bold text-white/80 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-emerald-400" />
                Reading Stats
              </h3>
              <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Stat tiles */}
              <div className="grid grid-cols-3 gap-3">
                <StatTile
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label="Total time"
                  value={`${Math.round(totalMinutes / 60)}h ${totalMinutes % 60}m`}
                />
                <StatTile
                  icon={<Flame className="h-3.5 w-3.5" />}
                  label="Streak"
                  value={`${streak} day${streak !== 1 ? 's' : ''}`}
                />
                <StatTile
                  icon={<Hash className="h-3.5 w-3.5" />}
                  label="Pages"
                  value={`${pagesReadTotal.toLocaleString()}`}
                />
              </div>

              {/* Heatmap grid */}
              <div>
                <h4 className="text-[10px] font-semibold text-white/30 uppercase tracking-wider mb-2">Past 12 weeks</h4>
                <div className="flex gap-0.5">
                  {/* Day labels */}
                  <div className="flex flex-col gap-0.5 mr-2 pt-0.5">
                    {dayLabels.map((label, i) => (
                      <div key={i} className="h-[11px] text-[8px] text-white/15 leading-[11px]">
                        {label}
                      </div>
                    ))}
                  </div>

                  {/* Heatmap cells: 7 rows (days) × 12 columns (weeks) */}
                  <div className="flex gap-0.5">
                    {Array.from({ length: 12 }).map((_, weekIdx) => (
                      <div key={weekIdx} className="flex flex-col gap-0.5">
                        {Array.from({ length: 7 }).map((_, dayIdx) => {
                          const cellIdx = weekIdx * 7 + dayIdx
                          const cell = heatmapData[cellIdx]
                          // Map day-of-week to actual cell (skip days that don't exist)
                          // This is a simplified mapping - for a real heatmap we'd align by actual day of week
                          if (!cell) return <div key={dayIdx} className="w-3 h-[11px] rounded-sm bg-transparent" />
                          return (
                            <div
                              key={dayIdx}
                              className={`w-3 h-[11px] rounded-sm ${levelColors[cell.level]} transition-colors`}
                              title={`${cell.date}: ${cell.minutes}min`}
                            />
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Legend */}
                <div className="flex items-center justify-end gap-1.5 mt-2 text-[9px] text-white/20">
                  <span>Less</span>
                  {levelColors.map((color, i) => (
                    <div key={i} className={`w-2.5 h-2.5 rounded-sm ${color}`} />
                  ))}
                  <span>More</span>
                </div>
              </div>

              {/* Daily breakdown (last 7 days) */}
              <div>
                <h4 className="text-[10px] font-semibold text-white/30 uppercase tracking-wider mb-2">Last 7 days</h4>
                <div className="space-y-1">
                  {heatmapData.slice(-7).reverse().map((d) => (
                    <div key={d.date} className="flex items-center gap-2">
                      <span className="text-[10px] text-white/30 w-8 tabular-nums">{d.day}</span>
                      <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500/50 rounded-full transition-all"
                          style={{ width: `${Math.min((d.minutes / 120) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-white/20 w-14 text-right tabular-nums">
                        {d.minutes > 0 ? `${d.minutes}min` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-3 text-center">
      <div className="flex items-center justify-center gap-1.5 text-white/30 mb-1">
        {icon}
        <span className="text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-bold text-white/80 tabular-nums">{value}</p>
    </div>
  )
}
