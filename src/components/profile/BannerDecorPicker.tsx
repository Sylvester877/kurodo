// BannerDecorPicker — visual picker for banner overlay effects.
// Shows a small preview card for each overlay pattern.

import { useProfileCustomization, OVERLAYS } from '../../store/useProfileCustomization'
import { useAuthStore } from '../../store/useAuthStore'
import { cn } from '../../lib/utils'

export default function BannerDecorPicker() {
  const auth = useAuthStore((s) => s.auth)
  const bannerOverlay = useProfileCustomization((s) => s.bannerOverlay)
  const setBannerOverlay = useProfileCustomization((s) => s.setBannerOverlay)

  const profileColor = auth?.user.profileColor || '#7c3aed'

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Add a decorative overlay to your profile banner. These appear on top of your AniList banner image (or accent color background).
      </p>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {OVERLAYS.map((overlay) => {
          const isSelected = bannerOverlay === overlay.id

          return (
            <button
              key={overlay.id ?? 'none'}
              onClick={() => setBannerOverlay(overlay.id)}
              className={cn(
                'relative group flex flex-col items-center gap-2 p-3 rounded-xl border transition-all',
                isSelected
                  ? 'border-primary bg-primary/10 shadow-[0_0_16px_-4px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.3)]'
                  : 'border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]',
              )}
            >
              {/* Banner preview card */}
              <div
                className={cn(
                  'relative h-16 w-full rounded-lg overflow-hidden',
                  overlay.className,
                )}
                style={{
                  background: `linear-gradient(135deg, ${profileColor}88 0%, ${profileColor}22 50%, #0a0a0a 100%)`,
                }}
              >
                {/* Simulated content lines */}
                <div className="absolute bottom-2 left-2 right-2 space-y-1">
                  <div className="h-1 w-3/4 rounded-full bg-white/20" />
                  <div className="h-1 w-1/2 rounded-full bg-white/10" />
                </div>

                {/* Simulated avatar */}
                <div className="absolute bottom-2 left-2 h-6 w-6 rounded-lg bg-white/15" />
              </div>

              {/* Label */}
              <span className={cn(
                'text-[11px] font-semibold transition-colors',
                isSelected ? 'text-primary' : 'text-white/60 group-hover:text-white/80',
              )}>
                {overlay.label}
              </span>

              {/* Selected indicator */}
              {isSelected && (
                <div className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.6)]" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
