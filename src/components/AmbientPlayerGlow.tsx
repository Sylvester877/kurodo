import { useEffect, useRef, useState, useCallback } from 'react'
import { useSettings } from '../store/useSettings'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** Whether the glow should be active (e.g., disabled when paused). */
  active?: boolean
  /** External dim signal — parent sets this when controls are visible. */
  dimmed?: boolean
}

const SAMPLE_INTERVAL = 2000 // ms between samples (~0.5fps — minimizes canvas GPU overhead)

/**
 * Ambient Player Glow — the "cinema mode" backdrop.
 *
 * Samples edge pixels from the video element at a low rate (~5fps),
 * computes an average color, and projects an ultra-blurred radial
 * gradient glow around the player. The result is a living, breathing
 * ambient background that changes with the scene, like Philips Hue
 * Ambilight but done entirely in CSS/Canvas.
 *
 * Dims when controls are visible so the UI stays readable.
 *
 * Disabled entirely when reduceQuality is true (integrated GPUs) —
 * canvas sampling + 100px CSS blur is too expensive on Iris Xe.
 */
export default function AmbientPlayerGlow({ videoRef, active = true, dimmed = false }: Props) {
  const reduceQuality = useSettings((s) => s.reduceQuality)
  const sampleCanvas = useRef<HTMLCanvasElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const [glowColor, setGlowColor] = useState<string>('hsla(354, 78%, 35%, 0.5)')

  const sample = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || video.videoWidth === 0) return
    let canvas = sampleCanvas.current
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 20
      sampleCanvas.current = canvas
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    // Draw a small thumbnail of the current frame (32×20 is plenty for
    // color sampling — we don't need detail, just the overall hue).
    ctx.drawImage(video, 0, 0, 32, 20)

    // Sample just the outer 2px ring of the thumbnail (edges) + a few
    // interior samples to capture the dominant scene color.
    const imageData = ctx.getImageData(0, 0, 32, 20).data
    let r = 0, g = 0, b = 0, count = 0

    const samplePixel = (x: number, y: number) => {
      const i = (y * 64 + x) * 4
      r += imageData[i]
      g += imageData[i + 1]
      b += imageData[i + 2]
      count++
    }

    // Top and bottom 2 rows
    for (let y = 0; y < 2; y++) for (let x = 0; x < 32; x++) samplePixel(x, y)
    for (let y = 18; y < 20; y++) for (let x = 0; x < 32; x++) samplePixel(x, y)

    // Left and right 3 columns
    for (let y = 2; y < 18; y++) {
      for (let x = 0; x < 3; x++) samplePixel(x, y)
      for (let x = 29; x < 32; x++) samplePixel(x, y)
    }

    // Center sample (dominant scene color)
    samplePixel(16, 10)

    if (count > 0) {
      r = Math.round(r / count)
      g = Math.round(g / count)
      b = Math.round(b / count)
      // Boost saturation so the glow pops, not washes out to grey.
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const satBoost = 1.5
      if (max !== min) {
        const dr = (r - (r + g + b) / 3) * satBoost
        const dg = (g - (r + g + b) / 3) * satBoost
        const db = (b - (r + g + b) / 3) * satBoost
        r = Math.min(255, Math.max(0, Math.round(r + dr)))
        g = Math.min(255, Math.max(0, Math.round(g + dg)))
        b = Math.min(255, Math.max(0, Math.round(b + db)))
      }
      setGlowColor(`rgba(${r}, ${g}, ${b}, 0.5)`)
    }
  }, [videoRef])

  useEffect(() => {
    if (!active) return
    sample()
    timerRef.current = window.setInterval(sample, SAMPLE_INTERVAL)
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [active, sample])

  // Disable on integrated GPUs — canvas sampling + 100px blur is expensive.
  // Early return AFTER all hooks so React's hook ordering is preserved.
  if (reduceQuality) return null

  return (
    <div aria-hidden className="pointer-events-none absolute -inset-[100px] -z-10"
      style={{
        background: `radial-gradient(ellipse at center, ${glowColor} 0%, transparent 70%)`,
        filter: 'blur(100px)',
        opacity: dimmed ? 0.35 : 0.8,
        transition: 'background-color 0.5s ease, opacity 0.4s ease',
      }}
    />
  )
}
