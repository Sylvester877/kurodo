import { ArrowLeft, Settings2, Bookmark, BookOpen, ChevronUp, ChevronDown, Maximize, Minimize } from 'lucide-react'
import { cn } from '../../lib/utils'

interface Props {
  onBack?: () => void
  onToggleSettings: () => void
  onToggleBookmarks: () => void
  onToggleStats: () => void
  onToggleFullscreen: () => void
  isFullscreen: boolean
  onPrevChapter?: () => void
  onNextChapter?: () => void
  canPrev: boolean
  canNext: boolean
  drawerOpen?: boolean
}

/**
 * Mobile-only horizontal toolbar — lg:hidden — mirrors RightToolStack
 * so phone users still get chapter nav + settings without the desktop spine.
 * Sits just above the bottom scrubber gradient (bottom-14) and respects zen.
 */
export default function MobileMangaToolbar({
  onBack,
  onToggleSettings,
  onToggleBookmarks,
  onToggleStats,
  onToggleFullscreen,
  isFullscreen,
  onPrevChapter,
  onNextChapter,
  canPrev,
  canNext,
  drawerOpen,
}: Props) {
  return (
    <div
      className={cn(
        'fixed bottom-[56px] left-1/2 -translate-x-1/2 z-30 flex lg:hidden items-center gap-1.5 rounded-full bg-[#0e131b]/92 backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.5)] px-1.5 py-1.5 transition-opacity duration-200',
        drawerOpen && 'opacity-0 pointer-events-none',
      )}
    >
      {onBack && (
        <button onClick={onBack} aria-label="Back to manga" className="h-8 w-8 grid place-items-center rounded-full bg-white/[0.06] text-white/60 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="h-5 w-px bg-white/[0.07] mx-0.5" />
      <button onClick={onPrevChapter} disabled={!canPrev} aria-label="Previous chapter" className={cn('h-8 w-8 grid place-items-center rounded-full', canPrev ? 'text-white/60 hover:text-white hover:bg-white/[0.08]' : 'text-white/15')}>
        <ChevronUp className="h-3.5 w-3.5 -rotate-90" />
      </button>
      <button onClick={onNextChapter} disabled={!canNext} aria-label="Next chapter" className={cn('h-8 w-8 grid place-items-center rounded-full', canNext ? 'text-white/60 hover:text-white hover:bg-white/[0.08]' : 'text-white/15')}>
        <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
      </button>
      <div className="h-5 w-px bg-white/[0.07] mx-0.5" />
      <button onClick={onToggleSettings} aria-label="Settings" className="h-8 w-8 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.08]">
        <Settings2 className="h-3.5 w-3.5" />
      </button>
      <button onClick={onToggleBookmarks} aria-label="Bookmarks" className="h-8 w-8 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.08]">
        <Bookmark className="h-3.5 w-3.5" />
      </button>
      <button onClick={onToggleStats} aria-label="Stats" className="h-8 w-8 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.08]">
        <BookOpen className="h-3.5 w-3.5" />
      </button>
      <button onClick={onToggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} className="h-8 w-8 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.08]">
        {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
