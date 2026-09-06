import { useEffect, useState } from 'react'

/**
 * Sample the dominant (average) colour of an image and return it as
 * "r g b" for use in rgba() / hsl() colour math — e.g. ambient page
 * glows that key off the anime's cover art.
 *
 * Gracefully no-ops when the image is same-origin-blocked (canvas
 * taint), the image fails to load, or the caller opts out
 * (`enabled: false`, used for reduceQuality / iGPU machines).
 */
export function useDominantColor(
  url: string | null | undefined,
  enabled = true,
): string | null {
  const [color, setColor] = useState<string | null>(null)

  useEffect(() => {
    if (!url || !enabled) {
      setColor(null)
      return
    }
    let cancelled = false

    const imgEl = new Image()
    imgEl.crossOrigin = 'anonymous'
    imgEl.decoding = 'async'
    imgEl.onload = () => {
      try {
        const size = 16
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('no ctx')
        ctx.drawImage(imgEl, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        // Weight centre pixels slightly so a big flat background (e.g. white
        // borders on posters) doesn't drown the art.
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4
            const cx = Math.abs(x - size / 2) / (size / 2)
            const cy = Math.abs(y - size / 2) / (size / 2)
            const weight = 1 + 0.6 * (1 - Math.max(cx, cy))
            r += data[i] * weight
            g += data[i + 1] * weight
            b += data[i + 2] * weight
            n += weight
          }
        }
        if (!cancelled) setColor(`${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)}`)
      } catch {
        if (!cancelled) setColor(null)
      }
    }
    imgEl.onerror = () => {
      if (!cancelled) setColor(null)
    }
    imgEl.src = url
    return () => {
      cancelled = true
    }
  }, [url, enabled])

  return color
}
