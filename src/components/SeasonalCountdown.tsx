import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Sparkles, Clock } from 'lucide-react'

/**
 * Anime seasons: Winter (Jan), Spring (Apr), Summer (Jul), Fall (Oct).
 * Shows a live countdown banner to the next season start with a link to /seasonal.
 * Recomputes every 60 minutes so the count stays fresh for long sessions.
 */
export default function SeasonalCountdown() {
  const [season, setSeason] = useState(() => getNextSeason())

  useEffect(() => {
    const interval = setInterval(() => setSeason(getNextSeason()), 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  if (!season) return null

  return (
    <section className="mt-8 mx-4">
      <Link
        to="/seasonal"
        className="group block relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:border-primary/20 transition-all duration-300"
      >
        {/* Background glow */}
        <div
          className="absolute inset-0 opacity-20 group-hover:opacity-30 transition-opacity duration-500"
          style={{
            background: `radial-gradient(ellipse 60% 60% at 80% 50%, ${season.color}44, transparent 70%)`,
          }}
        />

        <div className="relative flex items-center gap-4 sm:gap-6 p-4 sm:p-5">
          {/* Season icon */}
          <div
            className="shrink-0 h-12 w-12 sm:h-14 sm:w-14 rounded-2xl grid place-items-center transition-transform duration-300 group-hover:scale-105"
            style={{
              background: `linear-gradient(135deg, ${season.color}22, ${season.color}44)`,
              border: `1px solid ${season.color}33`,
              boxShadow: `0 0 24px 0 ${season.color}18`,
            }}
          >
            <Sparkles
              className="h-6 w-6 sm:h-7 sm:w-7"
              style={{ color: season.color }}
              strokeWidth={1.5}
            />
          </div>

          {/* Text content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                style={{
                  background: `${season.color}18`,
                  color: season.color,
                  border: `1px solid ${season.color}22`,
                }}
              >
                {season.label}
              </span>
              {season.daysUntil > 0 && (
                <span className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  Next season
                </span>
              )}
            </div>
            <p className="text-sm sm:text-base font-bold text-white group-hover:text-primary transition-colors">
              {season.title}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {season.daysUntil > 0
                ? `${season.daysUntil} day${season.daysUntil === 1 ? '' : 's'} until ${season.nextName} ${season.nextYear} season begins`
                : `${season.nextName} ${season.nextYear} season is starting now!`}
            </p>
          </div>

          {/* Countdown number */}
          <div className="shrink-0 text-center">
            <div
              className="text-2xl sm:text-3xl font-black tabular-nums tracking-tight"
              style={{ color: season.color }}
            >
              {season.daysUntil > 0 ? season.daysUntil : '🎉'}
            </div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              {season.daysUntil > 0 ? 'days' : 'now'}
            </div>
          </div>

          {/* Right arrow (desktop hover) */}
          <div className="hidden sm:flex shrink-0 h-8 w-8 rounded-full bg-white/[0.04] border border-white/[0.06] items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 group-hover:translate-x-0.5">
            <CalendarDays className="h-4 w-4 text-white/50" />
          </div>
        </div>
      </Link>
    </section>
  )
}

/**
 * Determine the next anime season and count days until it starts.
 */
function getNextSeason() {
  const now = new Date()
  const year = now.getFullYear()

  const seasons = [
    { name: 'Winter', startMonth: 0, color: '#06b6d4', label: 'JAN · FEB · MAR' },
    { name: 'Spring', startMonth: 3, color: '#f43f5e', label: 'APR · MAY · JUN' },
    { name: 'Summer', startMonth: 6, color: '#f59e0b', label: 'JUL · AUG · SEP' },
    { name: 'Fall',   startMonth: 9, color: '#d946ef', label: 'OCT · NOV · DEC' },
  ]

  // Find the next upcoming season
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i]
    const startDate = new Date(year, s.startMonth, 1)

    if (now < startDate) {
      const daysUntil = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      return {
        label: s.label,
        color: s.color,
        title: `New anime season approaching`,
        daysUntil,
        nextName: s.name,
        nextYear: year,
      }
    }
  }

  // All seasons for this year have passed — next is Winter of next year
  const nextSeason = seasons[0]
  const startDate = new Date(year + 1, nextSeason.startMonth, 1)
  const daysUntil = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  return {
    label: nextSeason.label,
    color: nextSeason.color,
    title: 'Looking ahead to next year',
    daysUntil,
    nextName: nextSeason.name,
    nextYear: year + 1,
  }
}
