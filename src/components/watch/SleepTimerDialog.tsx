import { useState } from 'react'
import { toast } from '../../components/Toaster'

interface SleepTimerDialogProps {
  open: boolean
  onClose: () => void
  onStart: (minutes: number) => void
}

export default function SleepTimerDialog({ open, onClose, onStart }: SleepTimerDialogProps) {
  const [value, setValue] = useState('30')

  if (!open) return null

  const handleStart = () => {
    const minutes = Number(value)
    if (minutes > 0) {
      onStart(minutes)
      toast.success(`Sleep in ${minutes} min`)
    }
    onClose()
    setValue('30')
  }

  const handleClose = () => {
    onClose()
    setValue('30')
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
      onClick={handleClose}
    >
      <div
        className="glass-card rounded-xl p-5 max-w-xs w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-white mb-3">Sleep timer</h3>
        <p className="text-xs text-white/60 mb-3">Set minutes until playback pauses:</p>
        <div className="flex gap-2 mb-4">
          {['15', '30', '45', '60'].map((m) => (
            <button
              key={m}
              onClick={() => setValue(m)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                value === m
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white/[0.04] text-white/60 border-white/10 hover:bg-white/[0.08]'
              }`}
            >
              {m}m
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mb-4">
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            min="1"
            max="240"
            placeholder="Custom"
            className="flex-1 h-9 px-3 rounded-lg bg-white/[0.04] border border-white/10 text-white text-sm focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/30 transition-colors"
          />
          <span className="text-xs text-white/40">min</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleClose}
            className="flex-1 py-2 rounded-lg text-xs font-semibold bg-white/[0.04] border border-white/10 text-white/60 hover:bg-white/[0.08] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={Number(value) <= 0}
            className="flex-1 py-2 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Start timer
          </button>
        </div>
      </div>
    </div>
  )
}
