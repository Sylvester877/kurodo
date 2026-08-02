import { useState, useCallback } from 'react'
import { useReaderStore, type FitMode, type ReadingDir, type ClickAction, type ClickTrigger, type PreviewMode, type ImageFilter, type BgTheme, type ColorMode, type PageTransition, type LoadingStrategy, type LoadingMethod, type ProgressIndicator, type ImagePreset, type BgPattern, type ReadingModePreset, presetToSettings } from '../store/useReaderStore'
import Row from './settings/Row'
import Toggle from './settings/Toggle'
import PillSegmented from './settings/PillSegmented'
import CustomSlider from './settings/CustomSlider'
import { X, BookOpen, Monitor, Image, Palette, PanelBottom, MousePointer2, FastForward, Maximize2, Layers, Keyboard, Zap, Undo2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  open: boolean
  onClose: () => void
}

type CategoryId = 'reading' | 'display' | 'image' | 'color' | 'background' | 'controls' | 'cursor' | 'auto' | 'page' | 'preview' | 'taps' | 'advanced'

interface Category {
  id: CategoryId
  label: string
  icon: React.ReactNode
}

const CATEGORIES: Category[] = [
  { id: 'reading', label: 'Reading', icon: <BookOpen className="h-3.5 w-3.5" /> },
  { id: 'display', label: 'Display', icon: <Monitor className="h-3.5 w-3.5" /> },
  { id: 'image', label: 'Image', icon: <Image className="h-3.5 w-3.5" /> },
  { id: 'color', label: 'Color', icon: <Palette className="h-3.5 w-3.5" /> },
  { id: 'background', label: 'Background', icon: <Layers className="h-3.5 w-3.5" /> },
  { id: 'controls', label: 'Controls', icon: <MousePointer2 className="h-3.5 w-3.5" /> },
  { id: 'cursor', label: 'Cursor', icon: <MousePointer2 className="h-3.5 w-3.5" /> },
  { id: 'auto', label: 'Auto-Advance', icon: <FastForward className="h-3.5 w-3.5" /> },
  { id: 'page', label: 'Page Mode', icon: <Maximize2 className="h-3.5 w-3.5" /> },
  { id: 'preview', label: 'Preview', icon: <PanelBottom className="h-3.5 w-3.5" /> },
  { id: 'taps', label: 'Tap Zones', icon: <Zap className="h-3.5 w-3.5" /> },
  { id: 'advanced', label: 'Advanced', icon: <Keyboard className="h-3.5 w-3.5" /> },
]

export default function ReaderSettingsModal({ open, onClose }: Props) {
  const store = useReaderStore()
  const [activeCat, setActiveCat] = useState<CategoryId>('reading')

  const handleReset = useCallback(() => {
    store.reset()
  }, [store])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-[720px] max-h-[85vh] bg-[#0a0a0a]/98 border border-white/[0.06] rounded-2xl shadow-lg shadow-black/50 overflow-hidden"
          >
            {/* ── Left: Category rail ── */}
            <div className="w-[160px] shrink-0 border-r border-white/[0.04] bg-white/[0.01] flex flex-col">
              <div className="p-3 border-b border-white/[0.04]">
                <h3 className="text-[11px] font-bold text-white/40 uppercase tracking-wider">Settings</h3>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
                {CATEGORIES.map((cat) => {
                  const isActive = activeCat === cat.id
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCat(cat.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-[11px] font-medium transition-all text-left
                        ${isActive
                          ? 'text-white bg-primary/10 border-r-2 border-primary'
                          : 'text-white/35 hover:text-white/60 hover:bg-white/[0.02] border-r-2 border-transparent'
                        }`}
                    >
                      <span className={isActive ? 'text-primary' : 'text-white/20'}>{cat.icon}</span>
                      {cat.label}
                    </button>
                  )
                })}
              </div>
              <div className="p-2 border-t border-white/[0.04]">
                <button
                  onClick={handleReset}
                  className="w-full flex items-center justify-center gap-1.5 text-[10px] text-white/25 hover:text-white/50 py-1.5 rounded-lg border border-white/[0.04] hover:border-white/10 transition-all"
                >
                  <Undo2 className="h-3 w-3" />
                  Reset all
                </button>
              </div>
            </div>

            {/* ── Right: Settings content ── */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white/80">
                  {CATEGORIES.find(c => c.id === activeCat)?.label}
                </h3>
                <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>


              {/* ── Reading ── */}
              {activeCat === 'reading' && (
                <div className="space-y-1">
                  <Row label="Preset" description="One-click reading style">
                    <PillSegmented<ReadingModePreset>
                      value={
                        store.readMode === 'strip' && store.stripGap === 0 ? 'webtoon' :
                        store.readMode === 'strip' && store.stripGap >= 16 ? 'long-strip' :
                        store.readMode === 'page' && store.spreadMode ? 'double-page' :
                        store.readMode === 'page' && store.readingDir === 'ttb' ? 'vertical' :
                        store.readMode === 'strip' ? 'long-strip' : 'single-page'
                      }
                      options={[
                        { value: 'webtoon', label: 'Webtoon' },
                        { value: 'long-strip', label: 'Long Strip' },
                        { value: 'single-page', label: 'Single' },
                        { value: 'double-page', label: 'Double' },
                        { value: 'vertical', label: 'Vertical' },
                      ]}
                      onChange={(v) => store.applyModePreset(v)}
                      size="xs"
                    />
                  </Row>
                  {store.readMode === 'page' && (
                    <>
                      <Row label="Spread" description="Show two pages side by side">
                        <Toggle checked={store.spreadMode} onChange={(v) => store.set('spreadMode', v)} />
                      </Row>
                      <Row label="Direction" description="Left-to-right or right-to-left">
                        <PillSegmented<ReadingDir>
                          value={store.readingDir}
                          options={[
                            { value: 'ltr', label: 'LTR' },
                            { value: 'rtl', label: 'RTL' },
                            { value: 'ttb', label: 'TTB' },
                          ]}
                          onChange={(v) => store.set('readingDir', v)}
                          size="sm"
                        />
                      </Row>
                    </>
                  )}
                </div>
              )}

              {/* ── Display ── */}
              {activeCat === 'display' && (
                <div className="space-y-1">
                  <Row label="Page Fit" description="How pages fill the viewport">
                    <PillSegmented<FitMode>
                      value={store.fitMode}
                      options={[
                        { value: 'width', label: 'Fit W' },
                        { value: 'height', label: 'Fit H' },
                        { value: 'none', label: '1:1' },
                      ]}
                      onChange={(v) => store.set('fitMode', v)}
                      size="xs"
                    />
                  </Row>
                  <Row label="Zoom" description={`${Math.round(store.zoomScale * 100)}%`}>
                    <div className="w-[180px]">
                      <CustomSlider
                        value={store.zoomScale}
                        onChange={(v) => store.set('zoomScale', v)}
                        min={1}
                        max={3}
                        step={0.05}
                        formatValue={(v) => `${Math.round(v * 100)}%`}
                        showLabels={false}
                      />
                    </div>
                  </Row>
                  {store.readMode === 'strip' && (
                    <>
                      <Row label="Strip max width" description={store.stripMaxWidth === 0 ? 'Full width' : `${store.stripMaxWidth}px`}>
                        <div className="w-[180px]">
                          <CustomSlider
                            value={store.stripMaxWidth}
                            onChange={(v) => store.set('stripMaxWidth', v)}
                            min={0}
                            max={1400}
                            step={50}
                            formatValue={(v) => v === 0 ? 'Full' : `${v}px`}
                            showLabels={false}
                          />
                        </div>
                      </Row>
                      <Row label="Page gap" description={`${store.stripGap}px between pages`}>
                        <div className="w-[180px]">
                          <CustomSlider
                            value={store.stripGap}
                            onChange={(v) => store.set('stripGap', v)}
                            min={0}
                            max={40}
                            step={2}
                            formatValue={(v) => `${v}px`}
                            showLabels={false}
                          />
                        </div>
                      </Row>
                    </>
                  )}
                </div>
              )}

              {/* ── Image ── */}
              {activeCat === 'image' && (
                <div className="space-y-1">
                  <Row label="Preset" description="One-click image tuning">
                    <div className="flex flex-col gap-2">
                      <PillSegmented<ImagePreset>
                        value={store.imagePreset}
                        options={[
                          { value: 'original', label: 'Original' },
                          { value: 'reading', label: 'Reading' },
                          { value: 'night', label: 'Night' },
                          { value: 'sepia', label: 'Sepia' },
                          { value: 'vivid', label: 'Vivid' },
                          { value: 'oled', label: 'OLED' },
                          { value: 'eink', label: 'E-Ink' },
                          { value: 'hdr', label: 'HDR' },
                        ]}
                        onChange={(v) => store.applyImagePreset(v)}
                        size="xs"
                      />
                      {/* Thumbnail preview strip for presets */}
                      <div className="flex gap-1.5 overflow-x-auto py-1">
                        {(['original', 'reading', 'night', 'sepia', 'vivid', 'oled', 'eink', 'hdr'] as ImagePreset[]).map((p) => {
                          const s = presetToSettings(p)
                          const hue = p === 'sepia' ? 'hue-rotate(-20deg)' : ''
                          const isActive = store.imagePreset === p
                          return (
                            <button
                              key={p}
                              onClick={() => store.applyImagePreset(p)}
                              className={`shrink-0 w-10 h-10 rounded-md border transition-all flex items-center justify-center text-[8px] font-semibold
                                ${isActive ? 'border-primary ring-1 ring-primary/30 scale-105' : 'border-white/[0.06] opacity-60 hover:opacity-90'}`}
                              style={{
                                background: p === 'night' ? '#1a1a2e' : p === 'sepia' ? '#3a2e22' : p === 'oled' ? '#000' : p === 'eink' ? '#e8e4dc' : p === 'hdr' ? '#0d1117' : '#111',
                                filter: `${hue} brightness(${s.brightness}%) saturate(${s.saturation}%) contrast(${s.contrast}%)`,
                              }}
                            >
                              <span style={{
                                opacity: 0.6,
                                background: `linear-gradient(135deg, ${p === 'eink' ? '#333' : '#888'} 40%, ${p === 'eink' ? '#555' : p === 'night' ? '#6af' : p === 'sepia' ? '#c9a96e' : p === 'vivid' ? '#ff6b8a' : p === 'oled' ? '#fff' : p === 'hdr' ? '#00ffcc' : '#6d28d9'} 60%)`,
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                              }}>Aa</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </Row>
                  <Row label="Brightness" description={`${store.imageBrightness}%`}>
                    <div className="w-[180px]">
                      <CustomSlider
                        value={store.imageBrightness}
                        onChange={(v) => store.set('imageBrightness', v)}
                        min={50}
                        max={150}
                        step={5}
                        formatValue={(v) => `${v}%`}
                        showLabels={false}
                      />
                    </div>
                  </Row>
                  <Row label="Smoothing" description="Pixelated for sharper scaling">
                    <PillSegmented<ImageFilter>
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
                    <PillSegmented<LoadingStrategy>
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
                    <div className="w-[180px]">
                      <CustomSlider
                        value={store.preloadPages}
                        onChange={(v) => store.set('preloadPages', v)}
                        min={0}
                        max={10}
                        step={1}
                        showLabels
                        minLabel="0"
                        maxLabel="10"
                      />
                    </div>
                  </Row>
                  <Row label="Loading method" description="How pages are loaded">
                    <PillSegmented<LoadingMethod>
                      value={store.loadingMethod}
                      options={[
                        { value: 'native', label: 'Native' },
                        { value: 'blob', label: 'Blob' },
                        { value: 'bg-image', label: 'Bg img' },
                      ]}
                      onChange={(v) => store.set('loadingMethod', v)}
                      size="xs"
                    />
                  </Row>
                </div>
              )}

              {/* ── Color ── */}
              {activeCat === 'color' && (
                <div className="space-y-1">
                  <Row label="Mode" description="Enhance colored manga pages">
                    <PillSegmented<ColorMode>
                      value={store.colorMode}
                      options={[
                        { value: 'natural', label: 'Natural' },
                        { value: 'enhanced', label: 'Enhanced' },
                        { value: 'custom', label: 'Custom' },
                      ]}
                      onChange={(v) => store.set('colorMode', v)}
                      size="sm"
                    />
                  </Row>
                  {store.colorMode === 'custom' && (
                    <>
                      <Row label="Saturation" description={`${store.colorSaturation}%`}>
                        <div className="w-[180px]">
                          <CustomSlider
                            value={store.colorSaturation}
                            onChange={(v) => store.set('colorSaturation', v)}
                            min={0}
                            max={200}
                            step={10}
                            formatValue={(v) => `${v}%`}
                            showLabels={false}
                          />
                        </div>
                      </Row>
                      <Row label="Contrast" description={`${store.colorContrast}%`}>
                        <div className="w-[180px]">
                          <CustomSlider
                            value={store.colorContrast}
                            onChange={(v) => store.set('colorContrast', v)}
                            min={50}
                            max={200}
                            step={10}
                            formatValue={(v) => `${v}%`}
                            showLabels={false}
                          />
                        </div>
                      </Row>
                    </>
                  )}
                  <Row label="Colored only" description="Only show colored chapters">
                    <Toggle checked={store.coloredOnly} onChange={(v) => store.set('coloredOnly', v)} />
                  </Row>
                </div>
              )}

              {/* ── Background ── */}
              {activeCat === 'background' && (
                <div className="space-y-1">
                  <Row label="Theme" description="Canvas color behind pages">
                    <PillSegmented<BgTheme>
                      value={store.bgTheme}
                      options={[
                        { value: 'black', label: 'Black' },
                        { value: 'dark', label: 'Dark' },
                        { value: 'sepia', label: 'Sepia' },
                        { value: 'light', label: 'Light' },
                      ]}
                      onChange={(v) => store.set('bgTheme', v)}
                      size="sm"
                    />
                  </Row>
                  <Row label="Pattern" description="Background texture overlay">
                    <PillSegmented<BgPattern>
                      value={store.bgPattern}
                      options={[
                        { value: 'solid', label: 'Solid' },
                        { value: 'paper', label: 'Paper' },
                        { value: 'gradient', label: 'Gradient' },
                        { value: 'dotted', label: 'Dotted' },
                        { value: 'lined', label: 'Lined' },
                      ]}
                      onChange={(v) => store.set('bgPattern', v)}
                      size="xs"
                    />
                  </Row>
                  {store.bgPattern !== 'solid' && (
                    <Row label="Intensity" description={`${store.paperIntensity}% pattern opacity`}>
                      <div className="w-[180px]">
                        <CustomSlider
                          value={store.paperIntensity}
                          onChange={(v) => store.set('paperIntensity', v)}
                          min={0}
                          max={100}
                          step={5}
                          formatValue={(v) => `${v}%`}
                          showLabels={false}
                        />
                      </div>
                    </Row>
                  )}
                </div>
              )}

              {/* ── Controls ── */}
              {activeCat === 'controls' && (
                <div className="space-y-1">
                  <Row label="Click Action" description="What a page click does">
                    <PillSegmented<ClickAction>
                      value={store.clickAction}
                      options={[
                        { value: 'next', label: 'Next/Prev' },
                        { value: 'settings', label: 'Settings' },
                      ]}
                      onChange={(v) => store.set('clickAction', v)}
                      size="sm"
                    />
                  </Row>
                  <Row label="Trigger" description="When the action fires">
                    <PillSegmented<ClickTrigger>
                      value={store.clickTrigger}
                      options={[
                        { value: 'release', label: 'On release' },
                        { value: 'press', label: 'On press' },
                      ]}
                      onChange={(v) => store.set('clickTrigger', v)}
                      size="sm"
                    />
                  </Row>
                  <Row label="Progress" description="What the bottom bar shows">
                    <PillSegmented<ProgressIndicator>
                      value={store.progressIndicator}
                      options={[
                        { value: 'page', label: 'Pg 3/24' },
                        { value: 'chapter', label: 'Ch. 12' },
                      ]}
                      onChange={(v) => store.set('progressIndicator', v)}
                      size="sm"
                    />
                  </Row>
                  <Row label="Notifications" description="Show toasts like auto-advance countdown">
                    <Toggle checked={store.showNotifications} onChange={(v) => store.set('showNotifications', v)} />
                  </Row>
                </div>
              )}

              {/* ── Cursor ── */}
              {activeCat === 'cursor' && (
                <div className="space-y-1">
                  <Row label="Show cursor" description="Hide cursor while reading">
                    <Toggle checked={store.cursorVisible} onChange={(v) => store.set('cursorVisible', v)} />
                  </Row>
                  <Row label="Wake distance" description={`Show cursor within ${store.cursorHideDist}px of movement`}>
                    <PillSegmented<string>
                      value={String(store.cursorHideDist)}
                      options={[
                        { value: '0', label: '0px' },
                        { value: '10', label: '10px' },
                        { value: '20', label: '20px' },
                        { value: '50', label: '50px' },
                      ]}
                      onChange={(v) => store.set('cursorHideDist', Number(v))}
                      size="xs"
                    />
                  </Row>
                </div>
              )}

              {/* ── Auto-Advance ── */}
              {activeCat === 'auto' && (
                <div className="space-y-1">
                  <Row label="Auto-advance" description="Navigate to next chapter when done reading">
                    <Toggle checked={store.autoAdvance} onChange={(v) => store.set('autoAdvance', v)} />
                  </Row>
                  {store.autoAdvance && (
                    <Row label="Countdown" description={`${store.autoAdvanceDelay}s before auto-advancing`}>
                      <PillSegmented<string>
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
                </div>
              )}

              {/* ── Page Mode ── */}
              {activeCat === 'page' && store.readMode === 'page' && (
                <div className="space-y-1">
                  <Row label="First page alone" description="Cover page stands alone in spread mode">
                    <Toggle checked={store.firstPageSingle} onChange={(v) => store.set('firstPageSingle', v)} />
                  </Row>
                  <Row label="Smooth transitions" description="Fade between pages">
                    <Toggle checked={store.smoothScroll} onChange={(v) => store.set('smoothScroll', v)} />
                  </Row>
                  {store.spreadMode && (
                    <Row label="Spread gap" description={`${store.spreadGap}px between paired pages`}>
                      <div className="w-[180px]">
                        <CustomSlider
                          value={store.spreadGap}
                          onChange={(v) => store.set('spreadGap', v)}
                          min={0}
                          max={40}
                          step={2}
                          formatValue={(v) => `${v}px`}
                          showLabels={false}
                        />
                      </div>
                    </Row>
                  )}
                  <Row label="Zoom lock" description="Keep zoom level across page navigations">
                    <Toggle checked={store.zoomLock} onChange={(v) => store.set('zoomLock', v)} />
                  </Row>
                </div>
              )}
              {activeCat === 'page' && store.readMode !== 'page' && (
                <p className="text-xs text-white/25 py-8 text-center">Switch to Page reading mode to see these options.</p>
              )}

              {/* ── Page Preview ── */}
              {activeCat === 'preview' && (
                <div className="space-y-1">
                  <Row label="Preview strip" description="Thumbnail navigation at bottom">
                    <PillSegmented<PreviewMode>
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
                </div>
              )}

              {/* ── Tap Zones ── */}
              {activeCat === 'taps' && (
                <div className="space-y-1">
                  <Row label="Left tap" description="Tap left third of screen">
                    <PillSegmented<ClickAction>
                      value={store.leftTapAction}
                      options={[
                        { value: 'previous', label: 'Prev' },
                        { value: 'next', label: 'Next' },
                        { value: 'settings', label: 'Settings' },
                      ]}
                      onChange={(v) => store.set('leftTapAction', v)}
                      size="sm"
                    />
                  </Row>
                  <Row label="Center tap" description="Tap center of screen">
                    <PillSegmented<ClickAction>
                      value={store.centerTapAction}
                      options={[
                        { value: 'settings', label: 'Settings' },
                        { value: 'next', label: 'Next' },
                        { value: 'previous', label: 'Prev' },
                      ]}
                      onChange={(v) => store.set('centerTapAction', v)}
                      size="sm"
                    />
                  </Row>
                  <Row label="Right tap" description="Tap right third of screen">
                    <PillSegmented<ClickAction>
                      value={store.rightTapAction}
                      options={[
                        { value: 'next', label: 'Next' },
                        { value: 'previous', label: 'Prev' },
                        { value: 'settings', label: 'Settings' },
                      ]}
                      onChange={(v) => store.set('rightTapAction', v)}
                      size="sm"
                    />
                  </Row>
                </div>
              )}

              {/* ── Advanced ── */}
              {activeCat === 'advanced' && (
                <div className="space-y-1">
                  <div className="text-[11px] text-white/40 space-y-1 mb-3">
                    <p><kbd className="text-[10px] bg-white/[0.06] px-1.5 py-0.5 rounded text-white/60">← → A D</kbd> Navigate pages</p>
                    <p><kbd className="text-[10px] bg-white/[0.06] px-1.5 py-0.5 rounded text-white/60">B</kbd> Bookmark current page</p>
                    <p><kbd className="text-[10px] bg-white/[0.06] px-1.5 py-0.5 rounded text-white/60">M</kbd> Toggle strip/page mode</p>
                    <p><kbd className="text-[10px] bg-white/[0.06] px-1.5 py-0.5 rounded text-white/60">F</kbd> Toggle fullscreen</p>
                    <p><kbd className="text-[10px] bg-white/[0.06] px-1.5 py-0.5 rounded text-white/60">S</kbd> Toggle spread</p>
                    <p><kbd className="text-[10px] bg-white/[0.06] px-1.5 py-0.5 rounded text-white/60">R</kbd> Toggle direction</p>
                    <p><kbd className="text-[10px] bg-white/[0.06] px-1.5 py-0.5 rounded text-white/60">G</kbd> Open settings</p>
                    <p><kbd className="text-[10px] bg-white/[0.06] px-1.5 py-0.5 rounded text-white/60">Esc</kbd> Close panels</p>
                  </div>
                  <Row label="Page transition" description="Animation between pages">
                    <PillSegmented<PageTransition>
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
                    <Toggle checked={store.zenMode} onChange={(v) => store.set('zenMode', v)} />
                  </Row>
                  <Row label="Volume key nav" description="Use volume keys to navigate">
                    <Toggle checked={store.volumeKeyNav} onChange={(v) => store.set('volumeKeyNav', v)} />
                  </Row>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
