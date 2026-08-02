export type LoadingStage = 'resolving' | 'fetching' | 'buffering' | 'done'

interface Props {
  /** Which stage we're currently on. 'done' hides the indicator. */
  stage: LoadingStage
  /** Optional descriptive text shown under the bar. */
  detail?: string
}

const STAGE_MESSAGES: Record<Exclude<LoadingStage, 'done'>, string> = {
  resolving: 'Finding stream sources…',
  fetching: 'Loading video stream…',
  buffering: 'Buffering…',
}

/**
 * Cinematic loading indicator with stage-aware messaging.
 *
 * Premium aesthetic upgrades:
 *   • Pulsing glow ring around the spinner (breathing animation)
 *   • Brand-gradient progress bar instead of flat primary
 *   • Shimmering dot wave instead of static pulse dots
 *   • Stage label badge above the message for context
 *
 * The progress bar fills over ~10s to give visual feedback while the
 * browser bridge does its work. When the video actually starts playing,
 * the parent swaps to the VideoPlayer which replaces this entirely.
 */
export default function PlayerLoadingStages({ stage, detail }: Props) {
  if (stage === 'done') return null

  const message = detail ?? STAGE_MESSAGES[stage]
  const stageLabel = stage === 'resolving' ? 'Step 1 of 3' : stage === 'fetching' ? 'Step 2 of 3' : 'Step 3 of 3'

  return (
    <div className="relative max-w-md w-full mx-auto px-6 text-center">
      {/* Pulsing glow ring + spinner — cinematic breathing effect */}
      <div className="relative mx-auto mb-5 w-16 h-16">
        {/* Outer glow — pulsing breathing ring using the glowPulse keyframe from index.css */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle, hsl(var(--theme-primary-h) var(--theme-primary-s) var(--theme-primary-l) / 0.25) 0%, transparent 70%)',
            animation: 'glowPulse 2s ease-in-out infinite',
          }}
        />
        {/* Spinner ring */}
        <div className="absolute inset-2 rounded-full border-2 border-white/10" />
        <div
          className="absolute inset-2 rounded-full border-2 border-transparent border-t-primary border-r-primary/40 animate-spin"
          style={{ animationDuration: '0.8s' }}
        />
        {/* Center dot — subtle brand color */}
        <div className="absolute inset-0 grid place-items-center">
          <div className="h-2 w-2 rounded-full bg-primary/80 animate-pulse" />
        </div>
      </div>

      {/* Stage label badge */}
      <div className="inline-block mb-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70 bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
          {stageLabel}
        </span>
      </div>

      {/* Stage message */}
      <p className="text-sm text-white/80 font-medium mb-1">
        {message}
      </p>

      {/* Optional detail */}
      {detail && detail !== message && (
        <p className="text-[11px] text-white/40 mb-2">{detail}</p>
      )}

      {/* Brand-gradient progress bar — fills over ~10s */}
      <div className="w-full h-[3px] bg-white/[0.06] rounded-full overflow-hidden mt-3 relative">
        <div
          className="h-full rounded-full"
          style={{
            animation: 'progressFill 10s ease-out forwards',
            background: 'linear-gradient(90deg, var(--brand-pink), var(--brand-purple))',
            boxShadow: '0 0 8px hsl(var(--theme-primary-h) var(--theme-primary-s) var(--theme-primary-l) / 0.4)',
          }}
        />
      </div>

      {/* Shimmering dot wave — 5 dots with staggered fade */}
      <div className="flex items-center justify-center gap-1.5 mt-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-primary/50"
            style={{
              animation: 'glowPulse 1.4s ease-in-out infinite',
              animationDelay: `${i * 160}ms`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
