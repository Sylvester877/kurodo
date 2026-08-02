import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { toast } from './Toaster'
import { cn } from '../lib/utils'

/**
 * One-time celebration when the user installs Kurōdo as a PWA.
 *
 *   - Listens for the `kurodo:app-installed` CustomEvent (dispatched from
 *     `useInstallApp` when the browser fires its native `appinstalled`).
 *   - Fires a `toast.success` with a friendly message.
 *   - Mounts a fixed-position confetti layer above the page for ~3s:
 *     48 small coloured chips that fall from the top of the viewport
 *     with random horizontal drift + spin, then unmount.
 *   - Module-level `lastFiredAt` guard ensures we only celebrate once
 *     per session even if multiple components subscribe (InstallButton
 *     + InstallPrompt both call useInstallApp).
 *   - Respects `prefers-reduced-motion` and the in-app `reduceMotion`
 *     setting — skips the confetti animation and just shows the toast.
 */
const COLOURS = [
  'bg-primary',         // anidap red
  'bg-amber-400',       // gold
  'bg-cyan-400',        // cyan
  'bg-emerald-400',     // green
  'bg-violet-400',      // violet
  'bg-pink-400',        // pink
  'bg-white',           // crisp highlight
]

interface ConfettiPiece {
  id: number
  x: number            // 0-100 (vw percentage)
  delay: number        // ms
  duration: number     // ms
  drift: number        // px (positive or negative)
  rotation: number     // initial deg
  size: number         // px
  colour: string
  shape: 'rect' | 'circle'
}

// Module-level guard — survives component remounts so we never celebrate twice.
let lastFiredAt = 0
const FIRE_COOLDOWN_MS = 5_000   // 5s; low enough that HMR reloads in dev replay
                                  // the celebration for visual QA, high enough to
                                  // suppress duplicate event dispatches from the
                                  // two useInstallApp consumers (Navbar button +
                                  // InstallPrompt modal).

function buildPieces(count: number): ConfettiPiece[] {
  const out: ConfettiPiece[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 350,
      duration: 2200 + Math.random() * 1400,
      drift: (Math.random() - 0.5) * 320,
      rotation: Math.random() * 360,
      size: 6 + Math.random() * 6,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      shape: Math.random() < 0.65 ? 'rect' : 'circle',
    })
  }
  return out
}

export default function Celebrations() {
  const [pieces, setPieces] = useState<ConfettiPiece[]>([])
  const cleanupTimer = useRef<number | null>(null)

  useEffect(() => {
    const onInstalled = () => {
      // De-dupe: a fresh mount (HMR / route change) shouldn't replay.
      const now = Date.now()
      if (now - lastFiredAt < FIRE_COOLDOWN_MS) return
      lastFiredAt = now

      // Always fire the toast — it works regardless of motion preference.
      toast.success('Kurōdo installed — enjoy the show! 🎉', 5000)

      // Skip confetti if user prefers reduced motion (or the in-app toggle).
      const reduceMotion =
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.documentElement.classList.contains('reduce-motion')
      if (reduceMotion) return

      setPieces(buildPieces(48))

      // Clear the confetti layer after the animation finishes so it doesn't
      // sit on top of the page indefinitely.
      if (cleanupTimer.current) window.clearTimeout(cleanupTimer.current)
      cleanupTimer.current = window.setTimeout(() => {
        setPieces([])
        cleanupTimer.current = null
      }, 4200)
    }
    window.addEventListener('kurodo:app-installed', onInstalled)
    return () => {
      window.removeEventListener('kurodo:app-installed', onInstalled)
      if (cleanupTimer.current) window.clearTimeout(cleanupTimer.current)
    }
  }, [])

  if (pieces.length === 0) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[200] overflow-hidden"
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          // `bg-*` Tailwind classes set `background-color` — DO NOT also set
          // `background` in the inline style (the shorthand would override
          // the class and the chips would all render as `currentColor`).
          style={{
            left: `${p.x}%`,
            top: '-12px',
            width: `${p.size}px`,
            height: p.shape === 'rect' ? `${p.size * 0.45}px` : `${p.size}px`,
            transform: `rotate(${p.rotation}deg)`,
            animationDelay: `${p.delay}ms`,
            animationDuration: `${p.duration}ms`,
            // CSS custom property consumed by the @keyframes below.
            '--drift': `${p.drift}px`,
          } as CSSProperties}
          className={cn(
            'absolute confetti-piece',
            p.colour,
            p.shape === 'circle' ? 'rounded-full' : 'rounded-[1.5px]',
          )}
        />
      ))}
    </div>
  )
}
