import { useRef, useEffect, useCallback, type ReactNode, type MouseEvent, type CSSProperties } from 'react'
import { cn } from '../lib/utils'

interface Props {
  children: ReactNode
  className?: string
  /** Max pixel displacement the button follows the cursor (default 8) */
  magnetism?: number
  /** Transition spring speed in ms (default 200) */
  speed?: number
  disabled?: boolean
}

/**
 * MagneticButton — wraps any button/link with a cursor-tracking magnetic
 * hover effect. The child subtly follows the mouse position within its
 * bounding box, creating a tactile feel.
 *
 * Trending on 21st.dev and awwwards (2026). Used by premium SaaS landing
 * pages (Linear, Vercel, Raycast).
 *
 * Respects @media (hover: hover) — only activates on devices with fine
 * pointers (desktop trackpads/mice).
 *
 * Usage:
 *   <MagneticButton>
 *     <button className="...">Click me</button>
 *   </MagneticButton>
 */
export default function MagneticButton({
  children,
  className,
  magnetism = 8,
  speed = 200,
  disabled,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const raf = useRef<number | null>(null)
  // We track the target position so we can lerp towards it via rAF
  const target = useRef({ x: 0, y: 0 })

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (disabled) return
      if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover)').matches) return
      const el = ref.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      // Mouse position relative to center of the element (-0.5..0.5)
      const cx = (e.clientX - rect.left) / rect.width - 0.5
      const cy = (e.clientY - rect.top) / rect.height - 0.5

      target.current = { x: cx * magnetism * 2, y: cy * magnetism * 2 }

      if (!raf.current) {
        raf.current = requestAnimationFrame(update)
      }
    },
    [disabled, magnetism],
  )

  const update = useCallback(() => {
    const el = ref.current
    if (!el) {
      raf.current = null
      return
    }

    // Smooth lerp towards target
    const tx = parseFloat(el.style.getPropertyValue('--mb-tx') || '0')
    const ty = parseFloat(el.style.getPropertyValue('--mb-ty') || '0')
    const lx = tx + (target.current.x - tx) * 0.12
    const ly = ty + (target.current.y - ty) * 0.12

    el.style.setProperty('--mb-tx', String(lx))
    el.style.setProperty('--mb-ty', String(ly))
    el.style.transform = `translate3d(${lx}px, ${ly}px, 0)`
    el.style.transition = 'none'

    raf.current = requestAnimationFrame(update)
  }, [])

  // Cleanup rAF on unmount to prevent running on detached DOM
  useEffect(() => {
    return () => {
      if (raf.current) {
        cancelAnimationFrame(raf.current)
        raf.current = null
      }
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    target.current = { x: 0, y: 0 }
    if (raf.current) {
      cancelAnimationFrame(raf.current)
      raf.current = null
    }
    const el = ref.current
    if (el) {
      el.style.transition = `transform ${speed}ms cubic-bezier(0.23, 1, 0.32, 1)`
      el.style.transform = 'translate3d(0, 0, 0)'
      el.style.removeProperty('--mb-tx')
      el.style.removeProperty('--mb-ty')
    }
  }, [speed])

  return (
    <div
      ref={ref}
      className={cn('inline-block', className)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={
        {
          '--mb-tx': '0',
          '--mb-ty': '0',
          transform: 'translate3d(0, 0, 0)',
          willChange: 'transform',
          transition: `transform ${speed}ms cubic-bezier(0.23, 1, 0.32, 1)`,
        } as CSSProperties
      }
    >
      {children}
    </div>
  )
}
