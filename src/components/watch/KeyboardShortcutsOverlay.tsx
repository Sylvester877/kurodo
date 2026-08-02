import { Keyboard, X } from 'lucide-react'

interface KeyboardShortcutsOverlayProps {
  open: boolean
  onClose: () => void
}

export default function KeyboardShortcutsOverlay({ open, onClose }: KeyboardShortcutsOverlayProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="glass-card rounded-2xl p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" /> Keyboard shortcuts
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {[
            ['Space / K', 'Play / Pause'],
            ['F', 'Fullscreen'],
            ['M', 'Mute / Unmute'],
            ['← / →', 'Seek ±5s'],
            ['J / L', 'Seek ±10s'],
            ['↑ / ↓', 'Volume ±5%'],
            ['N', 'Next episode'],
            ['P', 'Previous episode'],
            ['0–9', 'Jump to 0–90%'],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-white/90">
                {key}
              </kbd>
              <span className="text-xs text-muted-foreground text-right">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
