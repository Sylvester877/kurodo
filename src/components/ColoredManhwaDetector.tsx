import { useEffect, useRef } from 'react'
import { useReaderStore } from '../store/useReaderStore'

interface Props {
  /** Manga title or genres that might indicate colored content */
  mangaTitle?: string
  mangaGenres?: string[]
  /** Chapter-level colored detection */
  isColoredChapter?: boolean
  /** Whether to actually show the prompt */
  enabled?: boolean
}

/** Auto-detects colored manhwa/webtoon and prompts the user to apply
 *  the Vivid image preset for optimal color rendering. Only shows once
 *  per session (uses a session-level flag). */
export default function ColoredManhwaDetector({ mangaTitle, mangaGenres, isColoredChapter, enabled = true }: Props) {
  const imagePreset = useReaderStore((s) => s.imagePreset)
  const promptedRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!enabled || promptedRef.current) return
    if (imagePreset === 'vivid') return // Already using vivid

    const title = (mangaTitle || '').toLowerCase()
    const genres = (mangaGenres || []).join(' ').toLowerCase()

    // Heuristic: manhwa, webtoon, colored/colour/full-color/digital colored
    const isColoredManga =
      /colou?red|full.?color|official.?color|digital.?color|manhwa|webtoon/.test(title) ||
      /colou?red|manhwa|webtoon/.test(genres)

    // If the manga title or current chapter indicates colored content
    if (isColoredManga || isColoredChapter) {
      promptedRef.current = true

      // Show a toast suggesting Vivid preset (guard against unmount)
      import('./Toaster').then(({ toast }) => {
        if (!mountedRef.current) return
        toast(
          '🎨 This looks like a colored manga! Try the Vivid image preset for richer colors.',
          'info',
          5000,
        )
      })
    }
  }, [mangaTitle, mangaGenres, isColoredChapter, enabled])

  return null // This is a side-effect-only component
}
