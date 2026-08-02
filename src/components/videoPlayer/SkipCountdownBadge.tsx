interface SkipCountdownBadgeProps {
  remaining: number
  total: number
}

export default function SkipCountdownBadge({ remaining, total }: SkipCountdownBadgeProps) {
  const r = 13
  const circumference = 2 * Math.PI * r
  const progress = total > 0 ? (total - remaining) / total : 0
  const offset = circumference * (1 - progress)

  return (
    <div className="relative h-9 w-9 shrink-0 flex items-center justify-center">
      <svg
        className="absolute inset-0 -rotate-90"
        width="36"
        height="36"
        viewBox="0 0 36 36"
      >
        {/* Background ring */}
        <circle
          cx="18" cy="18" r={r}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="2"
        />
        {/* Progress arc */}
        <circle
          cx="18" cy="18" r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-primary transition-[stroke-dashoffset] duration-200 ease-linear"
        />
      </svg>
      <span className="relative text-[11px] font-bold text-white tabular-nums leading-none">
        {remaining}
      </span>
    </div>
  )
}
