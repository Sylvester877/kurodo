import { useReaderStore, type ReadMode, type FitMode, type ReadingDir, type ClickAction, type ClickTrigger, type PreviewMode, type ImageFilter, type BgTheme, type ColorMode, type PageTransition, type LoadingStrategy, type LoadingMethod, type ProgressIndicator } from '../store/useReaderStore'
import Row from './settings/Row'
import Toggle from './settings/Toggle'
import Select from './settings/Select'
import { X, Settings2, ArrowLeftRight, Image, ScrollText, Palette } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../lib/utils'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ReaderSettingsPanel({ open, onClose }: Props) {
  const store = useReaderStore()

  return (
    <AnimatePresence>
      {open && (
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="fixed top-0 right-0 bottom-0 w-[340px] z-50 bg-[#0a0a0a]/98 border-l border-white/[0.06] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white/90 flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Reader Settings
            </h3>
            <button onClick={onClose} className="text-white/30 hover:text-white/70">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Reading ── */}
          <Section label="Reading">
            <Row label="Mode" description="Strip scroll or page-by-page">
              <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                {(['strip', 'page'] as ReadMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => store.set('readMode', m)}
                    className={cn(
                      'px-3 py-1.5 text-[11px] font-semibold transition-colors flex items-center gap-1.5',
                      store.readMode === m
                        ? 'bg-primary/20 text-primary'
                        : 'text-white/35 hover:text-white/60',
                    )}
                  >
                    {m === 'strip' ? <ScrollText className="h-3 w-3" /> : <Image className="h-3 w-3" />}
                    {m === 'strip' ? 'Strip' : 'Page'}
                  </button>
                ))}
              </div>
            </Row>
            {store.readMode === 'page' && (
              <>
                <Row label="Spread" description="Show two pages side by side">
                  <Toggle
                    checked={store.spreadMode}
                    onChange={(v) => store.set('spreadMode', v)}
                  />
                </Row>
                <Row label="Direction" description="Left-to-right or right-to-left">
                  <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                    {(['ltr', 'rtl'] as ReadingDir[]).map((d) => (
                      <button
                        key={d}
                        onClick={() => store.set('readingDir', d)}
                        className={cn(
                          'px-3 py-1.5 text-[11px] font-semibold transition-colors flex items-center gap-1.5',
                          store.readingDir === d
                            ? 'bg-primary/20 text-primary'
                            : 'text-white/35 hover:text-white/60',
                        )}
                      >
                        <ArrowLeftRight className="h-3 w-3" />
                        {d.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </Row>
              </>
            )}
          </Section>

          {/* ── Display ── */}
          <Section label="Display">
            <Row label="Page Fit" description="How pages fill the viewport">
              <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                {([
                  { value: 'width', label: 'W' },
                  { value: 'height', label: 'H' },
                  { value: 'none', label: '1:1' },
                ] as { value: FitMode; label: string }[]).map((f) => (
                  <button
                    key={f.value}
                    onClick={() => store.set('fitMode', f.value)}
                    className={cn(
                      'px-2.5 py-1.5 text-[10px] font-bold transition-colors',
                      store.fitMode === f.value
                        ? 'bg-primary/20 text-primary'
                        : 'text-white/35 hover:text-white/60',
                    )}
                  >
                    {f.value === 'none' ? '1:1' : f.value === 'width' ? 'Fit W' : 'Fit H'}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Zoom" description={`${Math.round(store.zoomScale * 100)}%`}>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={store.zoomScale}
                onChange={(e) => store.set('zoomScale', Number(e.target.value))}
                className="w-24 accent-primary h-1"
              />
            </Row>
            {store.readMode === 'strip' && (
              <>
                <Row label="Strip max width" description={store.stripMaxWidth === 0 ? 'Full width' : `${store.stripMaxWidth}px`}>
                  <input
                    type="range"
                    min={0}
                    max={1400}
                    step={50}
                    value={store.stripMaxWidth}
                    onChange={(e) => store.set('stripMaxWidth', Number(e.target.value))}
                    className="w-24 accent-primary h-1"
                  />
                </Row>
                <Row label="Page gap" description={`${store.stripGap}px between pages`}>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    step={2}
                    value={store.stripGap}
                    onChange={(e) => store.set('stripGap', Number(e.target.value))}
                    className="w-24 accent-primary h-1"
                  />
                </Row>
              </>
            )}
          </Section>

          {/* ── Image ── */}
          <Section label="Image">
            <Row label="Brightness" description={`${store.imageBrightness}%`}>
              <input
                type="range"
                min={50}
                max={150}
                step={5}
                value={store.imageBrightness}
                onChange={(e) => store.set('imageBrightness', Number(e.target.value))}
                className="w-24 accent-primary h-1"
              />
            </Row>
            <Row label="Smoothing" description="Pixelated for sharper scaling">
              <Select<ImageFilter>
                value={store.imageFilter}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'pixelated', label: 'Pixelated' },
                  { value: 'crisp-edges', label: 'Crisp' },
                ]}
                onChange={(v) => store.set('imageFilter', v)}
                size="sm"
              />
            </Row>
            <Row label="Loading" description="Eager loads all pages upfront">
              <Select<LoadingStrategy>
                value={store.loadingStrategy}
                options={[
                  { value: 'lazy', label: 'Lazy' },
                  { value: 'eager', label: 'Eager' },
                ]}
                onChange={(v) => store.set('loadingStrategy', v)}
                size="sm"
              />
            </Row>
            <Row label="Preload pages" description={`Preload ${store.preloadPages} pages ahead of current`}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/25">0</span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={store.preloadPages}
                  onChange={(e) => store.set('preloadPages', Number(e.target.value))}
                  className="w-24 accent-primary h-1"
                />
                <span className="text-[10px] text-white/25">10</span>
                <span className="text-[10px] font-mono text-white/50 w-3 text-right tabular-nums">{store.preloadPages}</span>
              </div>
            </Row>
            <Row label="Loading method" description="How pages are loaded">
              <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                {([
                  { value: 'native', label: 'Native' },
                  { value: 'blob', label: 'Blob' },
                  { value: 'bg-image', label: 'Bg img' },
                ] as { value: LoadingMethod; label: string }[]).map((m) => (
                  <button
                    key={m.value}
                    onClick={() => store.set('loadingMethod', m.value)}
                    className={cn(
                      'px-2.5 py-1.5 text-[10px] font-semibold transition-colors',
                      store.loadingMethod === m.value
                        ? 'bg-primary/20 text-primary'
                        : 'text-white/35 hover:text-white/60',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </Row>
          </Section>

          {/* ── Color (for colored manga) ── */}
          <Section label="Color">
            <Row label="Mode" description="Enhance colored manga pages">
              <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                {([
                  { value: 'natural', label: 'Natural' },
                  { value: 'enhanced', label: 'Enhanced' },
                  { value: 'custom', label: 'Custom' },
                ] as { value: ColorMode; label: string }[]).map((m) => (
                  <button
                    key={m.value}
                    onClick={() => store.set('colorMode', m.value)}
                    className={cn(
                      'px-2.5 py-1.5 text-[10px] font-semibold transition-colors flex items-center gap-1',
                      store.colorMode === m.value
                        ? 'bg-primary/20 text-primary'
                        : 'text-white/35 hover:text-white/60',
                    )}
                  >
                    {m.value === 'enhanced' && <Palette className="h-3 w-3" />}
                    {m.label}
                  </button>
                ))}
              </div>
            </Row>
            {store.colorMode === 'custom' && (
              <>
                <Row label="Saturation" description={`${store.colorSaturation}%`}>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={10}
                    value={store.colorSaturation}
                    onChange={(e) => store.set('colorSaturation', Number(e.target.value))}
                    className="w-24 accent-primary h-1"
                  />
                </Row>
                <Row label="Contrast" description={`${store.colorContrast}%`}>
                  <input
                    type="range"
                    min={50}
                    max={200}
                    step={10}
                    value={store.colorContrast}
                    onChange={(e) => store.set('colorContrast', Number(e.target.value))}
                    className="w-24 accent-primary h-1"
                  />
                </Row>
              </>
            )}
            <Row label="Colored only" description="Only show colored chapters">
              <Toggle
                checked={store.coloredOnly}
                onChange={(v) => store.set('coloredOnly', v)}
              />
            </Row>
          </Section>

          {/* ── Background ── */}
          <Section label="Background">
            <Row label="Theme" description="Canvas color behind pages">
              <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                {([
                  { value: 'dark', bg: '#0a0a0a' },
                  { value: 'black', bg: '#000000' },
                  { value: 'sepia', bg: '#3a2e22' },
                  { value: 'light', bg: '#f5f0e6' },
                ] as { value: BgTheme; bg: string }[]).map((t) => (
                  <button
                    key={t.value}
                    onClick={() => store.set('bgTheme', t.value)}
                    className={cn(
                      'px-2.5 py-1.5 text-[10px] font-semibold transition-colors flex items-center gap-1',
                      store.bgTheme === t.value
                        ? 'bg-primary/20 text-primary'
                        : 'text-white/35 hover:text-white/60',
                    )}
                    title={t.value}
                  >
                    <span className="h-2.5 w-2.5 rounded-sm border border-white/15" style={{ backgroundColor: t.bg }} />
                    {t.value}
                  </button>
                ))}
              </div>
            </Row>
          </Section>

          {/* ── Controls ── */}
          <Section label="Controls">
            <Row label="Click Action" description="What a page click does">
              <Select<ClickAction>
                value={store.clickAction}
                options={[
                  { value: 'next', label: 'Next/Previous' },
                  { value: 'settings', label: 'Open Settings' },
                ]}
                onChange={(v) => store.set('clickAction', v)}
                size="sm"
              />
            </Row>
            <Row label="Trigger" description="When the action fires">
              <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                {(['release', 'press'] as ClickTrigger[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => store.set('clickTrigger', t)}
                    className={cn(
                      'px-2.5 py-1.5 text-[10px] font-semibold transition-colors',
                      store.clickTrigger === t
                        ? 'bg-primary/20 text-primary'
                        : 'text-white/35 hover:text-white/60',
                    )}
                  >
                    {t === 'release' ? 'On release' : 'On press'}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Progress" description="What the bottom bar shows">
              <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                {([
                  { value: 'page', label: 'Pg 3/24' },
                  { value: 'chapter', label: 'Ch. 12' },
                ] as { value: ProgressIndicator; label: string }[]).map((m) => (
                  <button
                    key={m.value}
                    onClick={() => store.set('progressIndicator', m.value)}
                    className={cn(
                      'px-2.5 py-1.5 text-[10px] font-semibold transition-colors',
                      store.progressIndicator === m.value
                        ? 'bg-primary/20 text-primary'
                        : 'text-white/35 hover:text-white/60',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Notifications" description="Show toasts like auto-advance countdown">
              <Toggle
                checked={store.showNotifications}
                onChange={(v) => store.set('showNotifications', v)}
              />
            </Row>
          </Section>

          {/* ── Cursor ── */}
          <Section label="Cursor">
            <Row label="Show cursor" description="Hide cursor while reading">
              <Toggle
                checked={store.cursorVisible}
                onChange={(v) => store.set('cursorVisible', v)}
              />
            </Row>
            <Row label="Wake distance" description={`Show cursor within ${store.cursorHideDist}px of movement`}>
              <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                {([0, 10, 20, 50] as number[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => store.set('cursorHideDist', d)}
                    className={cn(
                      'px-2.5 py-1.5 text-[10px] font-semibold transition-colors',
                      store.cursorHideDist === d
                        ? 'bg-primary/20 text-primary'
                        : 'text-white/35 hover:text-white/60',
                    )}
                  >
                    {d}px
                  </button>
                ))}
              </div>
            </Row>
          </Section>

          {/* ── Auto Advance ── */}
          <Section label="Auto Advance">
            <Row label="Auto-advance" description="Navigate to next chapter when done reading">
              <Toggle
                checked={store.autoAdvance}
                onChange={(v) => store.set('autoAdvance', v)}
              />
            </Row>
            {store.autoAdvance && (
              <Row label="Countdown" description={`${store.autoAdvanceDelay}s before auto-advancing`}>
                <Select<string>
                  value={String(store.autoAdvanceDelay)}
                  options={[
                    { value: '3', label: '3s' },
                    { value: '5', label: '5s' },
                    { value: '10', label: '10s' },
                    { value: '15', label: '15s' },
                    { value: '30', label: '30s' },
                  ]}
                  onChange={(v) => store.set('autoAdvanceDelay', Number(v))}
                  size="sm"
                />
              </Row>
            )}
          </Section>

          {/* ── Page Mode ── */}
          {store.readMode === 'page' && (
            <Section label="Page Mode">
              <Row label="First page alone" description="Cover page stands alone in spread mode">
                <Toggle
                  checked={store.firstPageSingle}
                  onChange={(v) => store.set('firstPageSingle', v)}
                />
              </Row>
              <Row label="Smooth transitions" description="Fade between pages">
                <Toggle
                  checked={store.smoothScroll}
                  onChange={(v) => store.set('smoothScroll', v)}
                />
              </Row>
              {store.spreadMode && (
                <Row label="Spread gap" description={`${store.spreadGap}px between paired pages`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/25">0</span>
                    <input
                      type="range"
                      min={0}
                      max={40}
                      step={2}
                      value={store.spreadGap}
                      onChange={(e) => store.set('spreadGap', Number(e.target.value))}
                      className="w-24 accent-primary h-1"
                    />
                    <span className="text-[10px] text-white/25">40</span>
                    <span className="text-[10px] font-mono text-white/50 w-3 text-right tabular-nums">{store.spreadGap}</span>
                  </div>
                </Row>
              )}
              <Row label="Zoom lock" description="Keep zoom level across page navigations">
                <Toggle
                  checked={store.zoomLock}
                  onChange={(v) => store.set('zoomLock', v)}
                />
              </Row>
            </Section>
          )}

          {/* ── Page Preview ── */}
          <Section label="Page Preview">
            <Row label="Preview strip" description="Thumbnail navigation at bottom">
              <Select<PreviewMode>
                value={store.previewMode}
                options={[
                  { value: 'attached', label: 'Attached' },
                  { value: 'hover', label: 'On hover' },
                  { value: 'off', label: 'Off' },
                ]}
                onChange={(v) => store.set('previewMode', v)}
                size="sm"
              />
            </Row>
          </Section>

          {/* ── Tap Zones ── */}
          <Section label="Tap Zones">
            <Row label="Left action" description="Tap left side of page">
              <Select<ClickAction>
                value={store.leftTapAction}
                options={[
                  { value: 'previous', label: 'Previous' },
                  { value: 'next', label: 'Next' },
                  { value: 'settings', label: 'Settings' },
                ]}
                onChange={(v) => store.set('leftTapAction', v)}
                size="sm"
              />
            </Row>
            <Row label="Center action" description="Tap center of page">
              <Select<ClickAction>
                value={store.centerTapAction}
                options={[
                  { value: 'settings', label: 'Settings' },
                  { value: 'next', label: 'Next' },
                  { value: 'previous', label: 'Previous' },
                ]}
                onChange={(v) => store.set('centerTapAction', v)}
                size="sm"
              />
            </Row>
            <Row label="Right action" description="Tap right side of page">
              <Select<ClickAction>
                value={store.rightTapAction}
                options={[
                  { value: 'next', label: 'Next' },
                  { value: 'previous', label: 'Previous' },
                  { value: 'settings', label: 'Settings' },
                ]}
                onChange={(v) => store.set('rightTapAction', v)}
                size="sm"
              />
            </Row>
          </Section>

          {/* ── Advanced ── */}
          <Section label="Advanced">
            <Row label="Page transition" description="Animation between pages">
              <Select<PageTransition>
                value={store.pageTransition}
                options={[
                  { value: 'instant', label: 'Instant' },
                  { value: 'fade', label: 'Fade' },
                  { value: 'slide', label: 'Slide' },
                ]}
                onChange={(v) => store.set('pageTransition', v)}
                size="sm"
              />
            </Row>
            <Row label="Zen mode" description="Hide all UI — top bar, bottom bar, controls">
              <Toggle
                checked={store.zenMode}
                onChange={(v) => store.set('zenMode', v)}
              />
            </Row>
            <Row label="Volume key nav" description="Use volume keys to navigate">
              <Toggle
                checked={store.volumeKeyNav}
                onChange={(v) => store.set('volumeKeyNav', v)}
              />
            </Row>
          </Section>

          {/* ── Keyboard shortcuts ── */}
          <Section label="Shortcuts">
            <div className="text-[11px] text-white/40 space-y-1">
              <p><kbd className="kbd-key">← →</kbd> Navigate pages</p>
              <p><kbd className="kbd-key">A D</kbd> Navigate pages</p>
              <p><kbd className="kbd-key">M</kbd> Toggle strip/page mode</p>
              <p><kbd className="kbd-key">F</kbd> Toggle fullscreen</p>
              <p><kbd className="kbd-key">S</kbd> Toggle spread (page mode)</p>
              <p><kbd className="kbd-key">R</kbd> Toggle direction (page mode)</p>
              <p><kbd className="kbd-key">G</kbd> Open settings</p>
              <p><kbd className="kbd-key">?</kbd> Keyboard help</p>
              <p><kbd className="kbd-key">Esc</kbd> Close panels / exit fullscreen</p>
              {store.volumeKeyNav && (
                <p><kbd className="kbd-key">Vol Up / Vol Down</kbd> Navigate pages</p>
              )}
            </div>
          </Section>

          {/* Reset */}
          <button
            onClick={() => store.reset()}
            className="w-full text-[11px] text-white/20 hover:text-white/50 py-2 rounded-lg border border-white/[0.04] hover:border-white/10 transition-colors"
          >
            Reset to defaults
          </button>
        </div>
      </motion.div>
      )}
    </AnimatePresence>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">{label}</h4>
      <div className="space-y-0">{children}</div>
    </div>
  )
}
