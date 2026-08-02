import { motion, AnimatePresence } from 'framer-motion'
import { X, Keyboard } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  isStrip: boolean
}

const KBD = ({ children }: { children: string }) => (
  <kbd className="kbd-key">
    {children}
  </kbd>
)

export default function KeyboardHelpModal({ open, onClose, isStrip }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-[60] bg-black/70"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className="fixed inset-0 z-[61] flex items-center justify-center p-4"
          >
            <div
              className="bg-[#0d0d0d]/98 border border-white/[0.06] rounded-2xl shadow-lg shadow-black/50 w-full max-w-[420px] max-h-[80vh] overflow-y-auto custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
                <h3 className="text-sm font-bold text-white/90 flex items-center gap-2">
                  <Keyboard className="h-4 w-4 text-primary" />
                  Keyboard Shortcuts
                </h3>
                <button
                  onClick={onClose}
                  className="text-white/25 hover:text-white/60 transition-colors"
                  title="Close (Esc)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Shortcuts grid */}
              <div className="p-5 space-y-4">
                <Section label="Navigation">
                  <Shortcut keys="← →" desc={isStrip ? 'Scroll pages' : 'Previous / Next page'} />
                  <Shortcut keys="A D"  desc={isStrip ? 'Scroll pages' : 'Previous / Next page'} />
                  <Shortcut keys={isStrip ? 'Space' : 'Space'} desc={isStrip ? 'Toggle auto-scroll' : '(strip mode only)'} />
                </Section>

                <Section label="Reading">
                  <Shortcut keys="M" desc="Toggle Strip / Page mode" />
                  <Shortcut keys="S" desc="Toggle Spread (page mode)" />
                  <Shortcut keys="R" desc="Toggle Reading Direction" />
                  <Shortcut keys="F" desc="Toggle Fullscreen" />
                </Section>

                <Section label="UI">
                  <Shortcut keys="G" desc="Open Reader Settings" />
                  <Shortcut keys="?" desc="Show this help" />
                  <Shortcut keys="Esc" desc="Close settings / help / fullscreen" />
                </Section>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-white/[0.05]">
                <p className="text-[10px] text-white/20 text-center">
                  Press <KBD>?</KBD> anytime to see this
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-bold text-white/25 uppercase tracking-wider mb-2">{label}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Shortcut({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1 flex-wrap">
        {keys.split(' ').map((k, i) => (
          <span key={i}>
            <KBD>{k}</KBD>
            {i < keys.split(' ').length - 1 && (
              <span className="text-white/15 mx-0.5 text-[10px]">+</span>
            )}
          </span>
        ))}
      </div>
      <span className="text-[11px] text-white/35 text-right">{desc}</span>
    </div>
  )
}
