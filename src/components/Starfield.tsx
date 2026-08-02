import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../store/useSettings'

/**
 * Heavy parallax starfield (anidap-style).
 *
 * Renders ~150 stars split across 3 depth layers (near / mid / far).  Each
 * star gets a random twinkle delay + duration so the field shimmers
 * organically.  On scroll, each layer translates at a different rate so the
 * near layer "catches up" with the camera while the far layer barely moves,
 * producing real depth.
 *
 * Stars are generated deterministically via a tiny seeded LCG so the
 * server-rendered HTML and the first client render are identical (avoids
 * hydration mismatches).
 */

interface Star {
  x: number          // 0..100 (%)
  y: number          // 0..100 (%)
  size: number       // px
  layer: 0 | 1 | 2
  delay: number      // twinkle delay in seconds
  duration: number   // twinkle cycle in seconds
  tint: '' | 'cyan' | 'violet' | 'warm'
  baseOpacity: number
}

// Mulberry32 — small, fast, good-enough PRNG
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildStars(count: number, seed: number): Star[] {
  const r = mulberry32(seed)
  const tints: Array<Star['tint']> = ['', 'cyan', 'violet', 'warm']
  return Array.from({ length: count }, (_, i) => {
    const layer = (i % 3) as 0 | 1 | 2
    // Layer-based sizing: near = bigger & brighter
    const size =
      layer === 0 ? 1.6 + r() * 1.6 :
      layer === 1 ? 1.0 + r() * 1.2 :
                    0.6 + r() * 0.9
    return {
      x: r() * 100,
      y: r() * 100,
      size,
      layer,
      delay: -(r() * 12),         // negative = already in-progress on first frame
      duration: 6 + r() * 8,      // 6..14s twinkle cycle (slower on Iris Xe)
      tint: tints[Math.floor(r() * tints.length)],
      baseOpacity: layer === 0 ? 0.95 : layer === 1 ? 0.8 : 0.55,
    }
  })
}

interface Props {
  /** Total stars to render across all layers. Defaults to a viewport-aware
   *  count (fewer on phones) when omitted. */
  count?: number
  /** Disable the scroll parallax (useful when prefers-reduced-motion is on). */
  staticLayers?: boolean
}

/** Viewport-aware default star count — keeps the hero light on phones /
 *  low-end devices (150 DOM nodes + a scroll listener is wasteful there)
 *  while preserving the rich field on desktop. */
function defaultStarCount(): number {
  if (typeof window === 'undefined') return 150
  const w = window.innerWidth
  if (w < 640) return 40
  if (w < 1024) return 60
  return 100
}

export default function Starfield({ count, staticLayers = false }: Props) {
  const reduceQuality = useSettings((s) => s.reduceQuality)
  const [scrollY, setScrollY] = useState(0)

  // Resolve the effective count once at mount so positions stay stable.
  const effectiveCount = useMemo(() => count ?? defaultStarCount(), [count])
  const stars = useMemo(() => buildStars(effectiveCount, 0xC0FFEE), [effectiveCount])

  useEffect(() => {
    if (reduceQuality || staticLayers) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setScrollY(window.scrollY))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    // Pause starfield updates when tab is hidden to save CPU
    const onVis = () => {
      if (document.hidden) {
        window.removeEventListener('scroll', onScroll)
        cancelAnimationFrame(raf)
      } else {
        onScroll()
        window.addEventListener('scroll', onScroll, { passive: true })
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVis)
      cancelAnimationFrame(raf)
    }
  }, [reduceQuality, staticLayers])

  // Disable entirely on integrated GPUs — starfield is purely decorative
  // and 100+ DOM nodes + scroll listener is wasteful on Iris Xe.
  // NOTE: placed AFTER all hooks to comply with Rules of Hooks.
  if (reduceQuality) return null

  // Parallax speeds per layer.  Near layer (largest stars) translates the
  // most so it "catches up" with the camera, creating depth.
  const speeds: Record<0 | 1 | 2, number> = { 0: 0.30, 1: 0.15, 2: 0.05 }

  return (
    <div className="starfield" aria-hidden>
      {/* Slow-drifting nebula haze for cinematic depth */}
      <div
        className="nebula nebula--cyan"
        style={{
          top: '8%', left: '6%', width: '45%', height: '55%',
          transform: staticLayers ? undefined : `translate3d(0, ${scrollY * -0.08}px, 0)`,
        }}
      />
      <div
        className="nebula nebula--violet"
        style={{
          top: '40%', left: '55%', width: '40%', height: '50%',
          transform: staticLayers ? undefined : `translate3d(0, ${scrollY * -0.05}px, 0)`,
        }}
      />
      <div
        className="nebula nebula--pink"
        style={{
          top: '60%', left: '20%', width: '35%', height: '40%',
          transform: staticLayers ? undefined : `translate3d(0, ${scrollY * -0.03}px, 0)`,
        }}
      />

      {/* Three depth layers of stars */}
      {([0, 1, 2] as const).map((layer) => (
        <div
          key={layer}
          className="starfield__layer"
          style={{
            transform: staticLayers
              ? undefined
              : `translate3d(0, ${-scrollY * speeds[layer]}px, 0)`,
          }}
        >
          {stars
            .filter((s) => s.layer === layer)
            .map((s, i) => (
              <span
                key={i}
                className={
                  'star ' +
                  (s.tint ? `star--${s.tint} ` : '') +
                  (layer === 0 ? 'star--near' : layer === 2 ? 'star--far' : '')
                }
                style={
                  {
                    left: `${s.x}%`,
                    top: `${s.y}%`,
                    width: `${s.size}px`,
                    height: `${s.size}px`,
                    '--twinkle-delay': `${s.delay}s`,
                    '--twinkle-dur': `${s.duration}s`,
                    '--base-opacity': s.baseOpacity,
                  } as React.CSSProperties
                }
              />
            ))}
        </div>
      ))}

      {/* Shooting stars — 3 long-lived streaks, each on a long cycle so
          the user occasionally sees one streak across the hero.  Static
          positions are deterministic so SSR + client render match. */}
      <span
        className="shooting-star shooting-star--long"
        style={{ top: '12%', left: '8%',  animationDelay: '-1.5s' }}
      />
      <span
        className="shooting-star shooting-star--cyan"
        style={{ top: '38%', left: '60%', animationDelay: '-6s', animationDuration: '13s' }}
      />
      <span
        className="shooting-star"
        style={{ top: '72%', left: '30%', animationDelay: '-9s', animationDuration: '9s' }}
      />
    </div>
  )
}
