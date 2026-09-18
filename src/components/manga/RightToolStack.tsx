import { ArrowLeft, Maximize, Minimize, MessageSquare, SlidersHorizontal, Bookmark, BookOpen, ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

interface Props {
  onBack?: () => void
  onToggleSettings: () => void
  onToggleFullscreen: () => void
  isFullscreen: boolean
  onToggleBookmarks: () => void
  onToggleStats: () => void
  onToggleComments?: () => void
  commentsCount?: number
  onPrevChapter?: () => void
  onNextChapter?: () => void
  canPrev: boolean
  canNext: boolean
  drawerOpen?: boolean
  className?: string
}

function ToolBtn({
  onClick,
  title,
  children,
  active,
  badge,
}: {
  onClick?: () => void
  title: string
  children: React.ReactNode
  active?: boolean
  badge?: number | string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'relative h-10 w-10 grid place-items-center rounded-xl border transition-all',
        active
          ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20'
          : 'bg-[#141a26]/90 backdrop-blur border-white/[0.07] text-white/55 hover:text-white hover:bg-white/[0.06] hover:border-white/15',
      )}
    >
      {children}
      {badge != null && String(badge).length > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-primary text-[9px] font-bold text-white leading-none">
          {badge}
        </span>
      )}
    </button>
  )
}

/**
 * Totally atsu.moe-inspired vertical tool stack at the right edge.
 * 40×40 buttons, 343px is reserved for the drawer — this sits at x~1390.
 */
export default function RightToolStack({
  onBack,
  onToggleSettings,
  onToggleFullscreen,
  isFullscreen,
  onToggleBookmarks,
  onToggleStats,
  onToggleComments,
  commentsCount,
  onPrevChapter,
  onNextChapter,
  canPrev,
  canNext,
  drawerOpen,
  className,
}: Props) {
  return (
    <div
      className={cn(
        'fixed right-3 top-1/2 -translate-y-1/2 z-30 hidden lg:flex flex-col items-center gap-2 transition-opacity duration-200',
        drawerOpen && 'opacity-0 pointer-events-none',
        className,
      )}
    >
      {onBack && (
        <ToolBtn onClick={onBack} title="Back to manga">
          <ArrowLeft className="h-4 w-4" />
        </ToolBtn>
      )}
      <div className="h-px w-6 bg-white/[0.06] my-0.5" />
      {/* Chapter nav pair */}
      <ToolBtn onClick={onPrevChapter} title="Previous chapter">
        <ChevronUp className={cn('h-4 w-4', !canPrev && 'opacity-30')} />
      </ToolBtn>
      <ToolBtn onClick={onNextChapter} title="Next chapter">
        <ChevronDown className={cn('h-4 w-4', !canNext && 'opacity-30')} />
      </ToolBtn>
      <div className="h-px w-6 bg-white/[0.06] my-0.5" />
      <ToolBtn onClick={onToggleSettings} title="Reader settings (G)">
        <SlidersHorizontal className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={onToggleBookmarks} title="Bookmarks (B)">
        <Bookmark className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={onToggleStats} title="Reading stats">
        <BookOpen className="h-4 w-4" />
      </ToolBtn>
      {onToggleComments && (
        <ToolBtn onClick={onToggleComments} title="Comments" badge={commentsCount}>
          <MessageSquare className="h-4 w-4" />
        </ToolBtn>
      )}
      <ToolBtn onClick={onToggleFullscreen} title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}>
        {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
      </ToolBtn>
    </div>
  )
}
