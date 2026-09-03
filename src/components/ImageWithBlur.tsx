import { useState, useRef, useEffect, useCallback } from 'react'
import { cn, getBackendOrigin } from '../lib/utils'

interface ImageWithBlurProps {
  src: string
  alt: string
  className?: string
  /** URL of a tiny (~20px wide) blurred placeholder. If omitted, generates one from src via canvas. */
  placeholderSrc?: string
  /** @deprecated No longer used — canvas blur generation was removed due to CORS issues. */
  placeholderSize?: number
  /** Blur amount in px for the placeholder. Default 12. */
  placeholderBlur?: number
  /** Transition duration in ms. Default 400. */
  fadeDuration?: number
  /** Whether to use native lazy loading. Default true. */
  lazy?: boolean
  style?: React.CSSProperties
  onClick?: (e: React.MouseEvent) => void
  onDoubleClick?: (e: React.MouseEvent) => void
  onLoad?: () => void
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void
  /** Responsive srcSet for different screen widths. */
  srcSet?: string
  /** Sizes attribute for responsive images. */
  sizes?: string
  draggable?: boolean
}

/**
 * Progressive image that shows a blurred placeholder while loading,
 * then crossfades to the full-resolution source.
 *
 * If `placeholderSrc` is provided, it's used as the blur layer.
 * Otherwise, the parent's gradient/CSS fallback handles the loading state.
 * (Canvas-based blur generation was removed because crossOrigin='anonymous'
 * breaks on CDNs without CORS headers — which is most anime CDNs.)
 */
export function ImageWithBlur({
  src,
  alt,
  className,
  placeholderSrc,
  placeholderBlur = 12,
  fadeDuration = 400,
  lazy = true,
  style,
  onClick,
  onDoubleClick,
  onLoad,
  onError,
  srcSet,
  sizes,
  draggable = false,
}: ImageWithBlurProps) {
  const [loaded, setLoaded] = useState(false)
  const [blurDataUrl, setBlurDataUrl] = useState<string>('')
  const imgRef = useRef<HTMLImageElement>(null)

  // ── Self-healing load pipeline ──
  // Some anime CDN images intermittently hang or fail when a grid fires off
  // dozens of parallel requests (s4.anilist.co is flaky under load). Rather
  // than showing a permanent grey box, retry the failed/hung image through
  // our own /img server proxy (server-side fetch + 48h cache) before giving
  // up. 0 = direct CDN, 1 = via proxy, 2 = exhausted (parent decides).
  const [attempt, setAttempt] = useState(0)
  const notifiedRef = useRef(false) // fire onLoad only once, ever
  const effectiveSrc =
    attempt === 0
      ? src
      : `${getBackendOrigin()}/img?url=${encodeURIComponent(src)}`

  // ── Blur placeholder ──
  // If an explicit placeholderSrc is provided, use it. Otherwise we skip
  // canvas-based blur generation (it required crossOrigin='anonymous' which
  // breaks on CDNs without CORS headers). The parent's gradient fallback
  // handles the loading state instead.
  useEffect(() => {
    if (placeholderSrc) {
      setBlurDataUrl(placeholderSrc)
    } else {
      setBlurDataUrl('')
    }
  }, [placeholderSrc])

  // ── Detect if image is already cached (instant load) ──
  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    if (el.complete && el.naturalWidth > 1 && !notifiedRef.current) {
      notifiedRef.current = true
      setLoaded(true)
      onLoad?.()
    }
  }, [src, onLoad])

  // ── Reset pipeline when the source changes ──
  useEffect(() => {
    setLoaded(false)
    setAttempt(0)
    notifiedRef.current = false
  }, [src])

  // ── Safety net: if onLoad never fires (hung request — no error event, the
  //    connection just stalls), retry via the proxy after 7s. This converts
  //    "thumbnail never shows up" into a working image a few seconds later.
  useEffect(() => {
    if (loaded || notifiedRef.current) return
    const timer = window.setTimeout(() => {
      if (attempt < 2) setAttempt(attempt + 1)
      else if (!notifiedRef.current) {
        notifiedRef.current = true
        onLoad?.() // exhausted — let the parent reveal its fallback
      }
    }, 7_000)
    return () => window.clearTimeout(timer)
  }, [loaded, attempt, onLoad])

  const handleLoad = useCallback(() => {
    if (!imgRef.current) return
    // Only mark loaded if the image actually has dimensions (not a broken/404 image).
    // Some CDNs serve a 1x1 spacer on 404 instead of triggering onError, which
    // the old code would treat as a valid load — revealing the grey fallback.
    if (imgRef.current.naturalWidth <= 1 && imgRef.current.naturalHeight <= 1) {
      // 1x1 spacer = upstream junk. Retry via proxy (which validates
      // content-type + size server-side) before surfacing the failure.
      setAttempt((a) => (a < 2 ? a + 1 : a))
      return
    }
    if (!notifiedRef.current) {
      notifiedRef.current = true
      setLoaded(true)
      onLoad?.()
    }
  }, [onLoad])

  const handleError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (attempt < 2) {
        setAttempt(attempt + 1)
        return
      }
      onError?.(e) // exhausted — parent's fallback (gradient/card) takes over
    },
    [attempt, onError],
  )

  return (
    <div className="relative overflow-hidden" style={style}>
      {/* Blur placeholder layer */}
      {blurDataUrl && !loaded && (
        <img
          src={blurDataUrl}
          alt=""
          aria-hidden="true"
          className={cn('absolute inset-0 w-full h-full object-cover', className)}
          style={{
            filter: `blur(${placeholderBlur}px)`,
            transform: 'scale(1.1)', // Prevent blur edge artifacts
          }}
        />
      )}
      {/* Full-resolution image */}
      <img
        ref={imgRef}
        src={effectiveSrc}
        alt={alt}
        className={cn(
          'w-full h-full object-cover',
          !loaded && 'opacity-0',
          loaded && 'opacity-100',
          className,
        )}
        style={{
          transition: `opacity ${fadeDuration}ms ease-out`,
        }}
        loading={lazy ? 'lazy' : 'eager'}
        srcSet={attempt === 0 ? srcSet : undefined}
        sizes={sizes}
        onLoad={handleLoad}
        onError={handleError}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        draggable={draggable}
      />
    </div>
  )
}

ImageWithBlur.displayName = 'ImageWithBlur'
