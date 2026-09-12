import { useReaderStore } from '../../store/useReaderStore'
import Row from '../settings/Row'
import Toggle from '../settings/Toggle'
import { cn } from '../../lib/utils'
import { Settings2 } from 'lucide-react'

interface Props {
  onOpenFull: () => void
}

export default function DrawerSettingsCompact({ onOpenFull }: Props) {
  const s = useReaderStore()
  return (
    <div className="space-y-4">
      {/* Quick toggles */}
      <div>
        <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">Quick</h4>
        <div className="space-y-2">
          <Row label="Mode" description={s.readMode === 'strip' ? 'Long strip' : 'Page'}>
            <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
              {(['strip', 'page'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => s.set('readMode', m)}
                  className={cn('px-3 py-1.5 text-[11px] font-semibold capitalize', s.readMode === m ? 'bg-primary/20 text-primary' : 'text-white/35')}
                >
                  {m}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Fit" description="How pages fill viewport">
            <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
              {(['width', 'height', 'none'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => s.set('fitMode', v)}
                  className={cn('px-2.5 py-1.5 text-[10px] font-bold', s.fitMode === v ? 'bg-primary/20 text-primary' : 'text-white/35')}
                >
                  {v === 'none' ? '1:1' : v === 'width' ? 'Fit W' : 'Fit H'}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Direction" description="Page mode only">
            <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
              {(['ltr', 'rtl'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => s.set('readingDir', d)}
                  className={cn('px-3 py-1.5 text-[11px] font-semibold', s.readingDir === d ? 'bg-primary/20 text-primary' : 'text-white/35')}
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
          </Row>
        </div>
      </div>

      <div>
        <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">Display</h4>
        <div className="space-y-2">
          <Row label="Brightness" description={`${s.imageBrightness}%`}>
            <input type="range" min={50} max={150} step={5} value={s.imageBrightness} onChange={(e) => s.set('imageBrightness', Number(e.target.value))} className="w-24 accent-primary h-1" />
          </Row>
          <Row label="Theme" description="Canvas behind pages">
            <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
              {(['black', 'dark', 'sepia', 'light'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => s.set('bgTheme', t as any)}
                  className={cn('px-2 py-1.5 text-[10px] font-semibold capitalize', s.bgTheme === t ? 'bg-primary/20 text-primary' : 'text-white/35')}
                >
                  {t}
                </button>
              ))}
            </div>
          </Row>
          {s.readMode === 'strip' && (
            <>
              <Row label="Auto-scroll" description="Strip only">
                <Toggle checked={s.autoScrollEnabled} onChange={(v) => s.set('autoScrollEnabled', v)} />
              </Row>
              {s.autoScrollEnabled && (
                <Row label="Speed" description={`${s.autoScrollSpeed}px/frame`}>
                  <input type="range" min={1} max={10} value={s.autoScrollSpeed} onChange={(e) => s.set('autoScrollSpeed', Number(e.target.value))} className="w-20 accent-primary h-1" />
                </Row>
              )}
            </>
          )}
        </div>
      </div>

      <div>
        <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">More</h4>
        <div className="space-y-1">
          <Row label="Zen mode" description="Hide all chrome">
            <Toggle checked={s.zenMode} onChange={(v) => s.set('zenMode', v)} />
          </Row>
          <Row label="Auto-advance" description="Next chapter at end">
            <Toggle checked={s.autoAdvance} onChange={(v) => s.set('autoAdvance', v)} />
          </Row>
        </div>
      </div>

      <button
        onClick={onOpenFull}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.06] border border-white/[0.06] text-xs font-semibold text-white/60 hover:text-white/85 transition-colors"
      >
        <Settings2 className="h-3.5 w-3.5" />
        Open full settings
      </button>
    </div>
  )
}
