import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '../lib/utils'

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
    if (el.complete && el.naturalWidth > 0) {
      setLoaded(true)
      onLoad?.()
    }
  }, [src, onLoad])

  // ── Safety net: if onLoad never fires (e.g. proxy drops the event or
  //    the image is already decoded before the listener attached), fade in
  //    after a generous delay. 10s gives slow CDNs / cold proxy caches time
  //    to deliver the image without prematurely revealing the grey fallback.
  //    The old 3s timeout was too aggressive and caused grey boxes on long
  //    anime with many episode thumbnails loading through the /img proxy.
  useEffect(() => {
    setLoaded(false)
    const timer = window.setTimeout(() => {
      setLoaded((prev) => {
        if (!prev) {
          onLoad?.()
          return true
        }
        return prev
      })
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [src, onLoad])

  const handleLoad = useCallback(() => {
    if (!imgRef.current) return
    // Only mark loaded if the image actually has dimensions (not a broken/404 image).
    // Some CDNs serve a 1x1 spacer on 404 instead of triggering onError, which
    // the old code would treat as a valid load — revealing the grey fallback.
    if (imgRef.current.naturalWidth <= 1 && imgRef.current.naturalHeight <= 1) return
    setLoaded(true)
    onLoad?.()
  }, [onLoad])

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
        src={src}
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
        srcSet={srcSet}
        sizes={sizes}
        onLoad={handleLoad}
        onError={onError}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        draggable={draggable}
      />
    </div>
  )
}

ImageWithBlur.displayName = 'ImageWithBlur'
