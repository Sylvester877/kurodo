// AvatarFramePicker — visual grid picker for decorative avatar frames.
// Shows a live preview of each frame on the user's current avatar.

import { useAuthStore } from '../../store/useAuthStore'
import { useProfileCustomization, FRAMES } from '../../store/useProfileCustomization'
import { User } from 'lucide-react'
import { proxifyImgUrl, cn } from '../../lib/utils'

export default function AvatarFramePicker() {
  const auth = useAuthStore((s) => s.auth)
  const avatarFrame = useProfileCustomization((s) => s.avatarFrame)
  const setAvatarFrame = useProfileCustomization((s) => s.setAvatarFrame)

  const avatarUrl = auth?.user.avatar
  const userName = auth?.user.name || 'User'

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Choose a decorative frame for your avatar. Frames appear on your profile page, comments, and activity feed.
      </p>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {FRAMES.map((frame) => {
          const isSelected = avatarFrame === frame.id

          return (
            <button
              key={frame.id ?? 'none'}
              onClick={() => setAvatarFrame(frame.id)}
              className={cn(
                'relative group flex flex-col items-center gap-2 p-3 rounded-xl border transition-all',
                isSelected
                  ? 'border-primary bg-primary/10 shadow-[0_0_16px_-4px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.3)]'
                  : 'border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]',
              )}
            >
              {/* Avatar preview with frame */}
              <div
                className={cn(
                  'relative h-16 w-16 rounded-2xl overflow-hidden transition-all duration-300',
                  frame.className,
                )}
                style={{
                  ...(frame.id ? frame.style : {
                    boxShadow: '0 0 0 2px rgba(255,255,255,0.08)',
                  }),
                }}
              >
                {avatarUrl ? (
                  <img
                    src={proxifyImgUrl(avatarUrl)}
                    alt={userName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-white/[0.04] grid place-items-center">
                    <User className="h-8 w-8 text-white/20" />
                  </div>
                )}
              </div>

              {/* Label */}
              <span className={cn(
                'text-[11px] font-semibold transition-colors',
                isSelected ? 'text-primary' : 'text-white/60 group-hover:text-white/80',
              )}>
                {frame.label}
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
