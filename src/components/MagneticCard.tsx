import { useRef, useCallback, type ReactNode, type MouseEvent } from 'react'
import { cn } from '../lib/utils'

interface Props {
  children: ReactNode
  className?: string
  /** Max rotation in degrees (default 5) */
  maxRotate?: number
  /** Perspective distance in px (default 800) */
  perspective?: number
  /** Scale on press (default 0.97) */
  pressScale?: number
  disabled?: boolean
}

/**
 * 3D magnetic tilt wrapper — adds perspective-based rotation on hover.
 * Only activates on devices with fine pointers (@media hover: hover).
 * Provides a premium, tactile feel to card grids.
 */
export default function MagneticCard({
  children,
  className,
  maxRotate = 5,
  perspective = 800,
  pressScale = 0.97,
  disabled,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const active = useRef(false)

  const reset = useCallback(() => {
    if (!ref.current) return
    active.current = false
    ref.current.style.transform = `perspective(${perspective}px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)`
    ref.current.style.transition = 'transform 500ms cubic-bezier(0.23, 1, 0.32, 1)'
  }, [perspective])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (disabled) return
      if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover)').matches) return
      const el = ref.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width - 0.5
      const y = (e.clientY - rect.top) / rect.height - 0.5

      const rotateX = -y * maxRotate
      const rotateY = x * maxRotate
      const scale = active.current ? pressScale : 1

      el.style.transition = 'transform 150ms cubic-bezier(0.23, 1, 0.32, 1)'
      el.style.transform = `perspective(${perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(${scale},${scale},1)`
    },
    [disabled, maxRotate, perspective, pressScale],
  )

  const handleMouseDown = useCallback(() => {
    if (disabled) return
    active.current = true
    if (ref.current) {
      ref.current.style.transition = 'transform 100ms cubic-bezier(0.23, 1, 0.32, 1)'
    }
  }, [disabled])

  const handleMouseUp = useCallback(() => {
    active.current = false
    if (ref.current) {
      ref.current.style.transition = 'transform 300ms cubic-bezier(0.23, 1, 0.32, 1)'
    }
  }, [])

  const handleMouseLeave = useCallback(
    () => {
      active.current = false
      reset()
    },
    [reset],
  )

  return (
    <div
      ref={ref}
      className={cn('magnetic-card', className)}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{
        transformStyle: 'preserve-3d',
        transform: `perspective(${perspective}px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)`,
      }}
    >
      {children}
    </div>
  )
}
