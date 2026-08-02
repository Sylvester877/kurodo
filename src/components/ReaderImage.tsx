import { forwardRef, useState, useEffect, useRef, useCallback } from 'react'
import type { LoadingMethod } from '../store/useReaderStore'

interface ReaderImageProps {
  url: string
  alt: string
  className?: string
  style?: React.CSSProperties
  loadingMethod: LoadingMethod
  /** Only used by native mode — sets the <img loading> attribute */
  imgLoading?: 'eager' | 'lazy'
  onClick?: (e: React.MouseEvent) => void
  onDoubleClick?: (e: React.MouseEvent) => void
  /** Fade-in transition duration in ms. 0 = instant. Default 200. */
  fadeIn?: number
  /** Generated blur placeholder URL (tiny blurred thumbnail). Shown while loading. */
  blurPlaceholder?: string
  onLoad?: () => void
}

/**
 * Renders a manga page using one of three loading strategies:
 * - native:     plain <img src={url}> (default browser behaviour)
 * - blob:       fetch image, createObjectURL, render <img> with blob URL
 * - bg-image:   render <div> with CSS background-image (no <img> element)
 *
 * Blob mode is useful for avoiding CORS/cache quirks with certain CDNs.
 * Bg-image mode is purely cosmetic — pages render as CSS backgrounds.
 */
export const ReaderImage = forwardRef<HTMLElement, ReaderImageProps>(
  ({ url, alt, className, style, loadingMethod, imgLoading, onClick, onDoubleClick, fadeIn = 200, blurPlaceholder, onLoad }, ref) => {
    const [blobUrl, setBlobUrl] = useState<string>('')
    const [loaded, setLoaded] = useState(false)
    const [autoBlurUrl, setAutoBlurUrl] = useState<string>('')
    const blobUrlRef = useRef('')
    const prevUrl = useRef(url)

    // Reset loaded state when URL changes
    useEffect(() => {
      setLoaded(false)
    }, [url])

    // ── Auto-generate blur placeholder from URL when not provided ──
    useEffect(() => {
      if (blurPlaceholder) {
        setAutoBlurUrl(blurPlaceholder)
        return
      }
      setAutoBlurUrl('')
      // Only auto-generate if fadeIn is set (implies we want progressive loading)
      if (fadeIn <= 0) return

      // ── Throttle: use requestIdleCallback to avoid flooding the browser
      //     with 50+ concurrent Image + canvas allocations in strip mode.
      //     On Iris Xe's shared memory, this prevents thrashing.
      const schedule = (fn: () => void) => {
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(fn, { timeout: 500 })
        } else {
          setTimeout(fn, 10)
        }
      }

      let cancelled = false
      const work = () => {
        if (cancelled) return
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          if (cancelled) return
          try {
            const canvas = document.createElement('canvas')
            const ratio = img.naturalHeight / img.naturalWidth
            canvas.width = 20
            canvas.height = Math.round(20 * ratio)
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
            setAutoBlurUrl(canvas.toDataURL('image/jpeg', 0.3))
          } catch {
            // Canvas tainted by CORS-restricted CDN — silently fall back
            setAutoBlurUrl('')
          }
        }
        img.onerror = () => {
          if (!cancelled) setAutoBlurUrl('')
        }
        img.src = url
      }

      schedule(work)
      return () => { cancelled = true }
    }, [url, blurPlaceholder, fadeIn])

    const effectiveBlurPlaceholder = blurPlaceholder || autoBlurUrl

    const handleLoad = useCallback(() => {
      setLoaded(true)
      onLoad?.()
    }, [onLoad])

    // ── Blob fetch ──
    useEffect(() => {
    if (loadingMethod !== 'blob') {
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = ''; setBlobUrl('') }
      prevUrl.current = url
      return
    }

      let active = true
      prevUrl.current = url

      fetch(url)
        .then((res) => res.blob())
        .then((blob) => {
          if (active && prevUrl.current === url) {
            const objectUrl = URL.createObjectURL(blob)
            // Revoke previous blob URL first
            if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
            blobUrlRef.current = objectUrl
            setBlobUrl(objectUrl)
          }
        })
        .catch(() => {
          // Silently fall back to original URL on fetch failure
          if (active) { blobUrlRef.current = ''; setBlobUrl('') }
        })

      return () => {
        active = false
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = '' }
      }
    }, [url, loadingMethod])

    // ── bg-image mode: render <div> with CSS background ──
    if (loadingMethod === 'bg-image') {
      return (
        <div className="relative" style={{ width: (style as any)?.width, height: (style as any)?.height }}>
          {effectiveBlurPlaceholder && !loaded && (
            <div
              aria-hidden="true"
              className={className}
              style={{
                backgroundImage: `url(${effectiveBlurPlaceholder})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                filter: 'blur(8px)',
                transform: 'scale(1.05)',
                position: 'absolute',
                inset: 0,
              }}
            />
          )}
          <div
            ref={ref as React.Ref<HTMLDivElement>}
            className={className}
            style={{
              ...style,
              backgroundImage: `url(${url})`,
              backgroundSize: 'contain',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              width: undefined,
              height: undefined,
              opacity: !loaded && effectiveBlurPlaceholder ? 0 : 1,
              transition: fadeIn > 0 ? `opacity ${fadeIn}ms ease-out` : undefined,
            }}
            role="img"
            aria-label={alt}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onLoad={handleLoad}
          />
          {/* Hidden img to detect load completion for bg-image mode */}
          <img
            src={url}
            alt=""
            aria-hidden="true"
            className="hidden"
            onLoad={handleLoad}
            onError={handleLoad}
          />
        </div>
      )
    }

    // ── Native or blob mode: render <img> ──
    const src = loadingMethod === 'blob' ? (blobUrl || url) : url

    return (
      <div className="relative" style={{ display: 'contents' }}>
        {effectiveBlurPlaceholder && !loaded && (
          <img
            src={effectiveBlurPlaceholder}
            alt=""
            aria-hidden="true"
            className={className}
            style={{
              ...style,
              filter: 'blur(8px)',
              transform: 'scale(1.05)',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          />
        )}
        <img
          ref={ref as React.Ref<HTMLImageElement>}
          src={src || url}
          alt={alt}
          className={className}
          style={{
            ...style,
            opacity: !loaded && effectiveBlurPlaceholder ? 0 : 1,
            transition: fadeIn > 0 ? `opacity ${fadeIn}ms ease-out` : undefined,
          }}
          draggable={false}
          loading={imgLoading}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onLoad={handleLoad}
        />
      </div>
    )
  },
)

ReaderImage.displayName = 'ReaderImage'
