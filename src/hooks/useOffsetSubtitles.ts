import { useEffect, useMemo, useRef, useState } from 'react'
import { applyVttOffset } from '../lib/vtt'

export interface SubtitleTrack {
  src: string
  label: string
  default?: boolean
  lang?: string
}

export function useOffsetSubtitles(subtitles: SubtitleTrack[], offset: number): SubtitleTrack[] {
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({})
  // Keep a live reference to the current blob URLs so we can revoke them on unmount.
  const blobUrlsRef = useRef<Record<string, string>>({})
  blobUrlsRef.current = blobUrls

  useEffect(() => {
    return () => {
      Object.values(blobUrlsRef.current).forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])
  // Stable key so the effect only re-runs when actual subtitle URLs change.
  const subtitleKey = useMemo(() => subtitles.map((s) => s.src).join('\x00'), [subtitles])

  useEffect(() => {
    if (offset === 0) {
      // Only clear if we actually have active blob URLs
      setBlobUrls((prev) => {
        if (Object.keys(prev).length === 0) return prev
        Object.values(prev).forEach((u) => URL.revokeObjectURL(u))
        return {}
      })
      return
    }

    let cancelled = false
    const newBlobs: Record<string, string> = {}

    // Fetch each subtitle individually with its own error handler so
    // one failing subtitle doesn't abandon blob URLs already created
    // for the others — those would leak if Promise.all rejects mid-way.
    Promise.all(
      subtitles.map(async (sub) => {
        try {
          const text = await fetch(sub.src).then((r) => r.text())
          const modified = applyVttOffset(text, offset)
          const blob = new Blob([modified], { type: 'text/vtt' })
          const blobUrl = URL.createObjectURL(blob)
          newBlobs[sub.src] = blobUrl
        } catch {
          // If fetch fails, keep the original URL (no blob created).
          // Don't throw — we don't want Promise.all to reject and
          // skip revoking blobs already created for other subtitles.
        }
      }),
    ).then(() => {
      if (!cancelled) {
        setBlobUrls((prev) => {
          Object.values(prev).forEach((u) => URL.revokeObjectURL(u))
          return newBlobs
        })
      } else {
        // Clean up orphaned blob URLs when component unmounted mid-fetch
        Object.values(newBlobs).forEach((u) => URL.revokeObjectURL(u))
      }
    })

    return () => {
      cancelled = true
      // Can't revoke newBlobs here because they may not be created yet.
      // The .then() callback handles cleanup if cancelled.
    }
  }, [subtitleKey, offset])

  return subtitles.map((sub) => ({
    ...sub,
    src: blobUrls[sub.src] || sub.src,
  }))
}
