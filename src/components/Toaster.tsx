import { useEffect, useState, useCallback } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '../lib/utils'

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  /** Auto-dismiss after this many ms. Default 3500. Pass 0 to disable. */
  duration?: number
}

// ─────────────────────────────────────────────────────────
// Module-level event bus — call toast() from anywhere
// without a Context/Provider.
// ─────────────────────────────────────────────────────────
type Listener = (t: Toast) => void
const listeners = new Set<Listener>()
let nextId = 1

export function toast(message: string, kind: ToastKind = 'info', duration = 3500) {
  const t: Toast = { id: nextId++, message, kind, duration }
  listeners.forEach((l) => l(t))
  return t.id
}

toast.success = (msg: string, duration?: number) => toast(msg, 'success', duration)
toast.error   = (msg: string, duration?: number) => toast(msg, 'error', duration)
toast.info    = (msg: string, duration?: number) => toast(msg, 'info', duration)

// ─────────────────────────────────────────────────────────
// Toaster component — mount once near the root.
// ─────────────────────────────────────────────────────────
const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const

const ICON_COLOURS: Record<ToastKind, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  info: 'text-primary',
}

export default function Toaster() {
  const [items, setItems] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id))
  }, [])

  useEffect(() => {
    const onToast: Listener = (t) => {
      setItems((cur) => [...cur, t])
      if (t.duration !== 0) {
        window.setTimeout(() => dismiss(t.id), t.duration ?? 3500)
      }
    }
    listeners.add(onToast)
    return () => { listeners.delete(onToast) }
  }, [dismiss])

  if (items.length === 0) return null

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed top-20 right-4 z-[60] flex flex-col gap-2 pointer-events-none"
    >
      {items.map((t) => {
        const Icon = ICONS[t.kind]
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-center gap-3 min-w-[280px] max-w-md',
              'glass-card rounded-xl border px-4 py-3 shadow-2xl',
              'animate-[fadeInUp_0.25s_ease]',
              t.kind === 'success' && 'border-emerald-500/30',
              t.kind === 'error'   && 'border-red-500/30',
              t.kind === 'info'    && 'border-primary/30',
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', ICON_COLOURS[t.kind])} />
            <p className="text-sm text-white flex-1 leading-tight">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="text-muted-foreground hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
