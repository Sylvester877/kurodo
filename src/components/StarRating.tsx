import { useState, useEffect, useCallback } from 'react'
import { Star } from 'lucide-react'
import { cn } from '../lib/utils'
import { saveListEntry } from '../api/anilistAuth'
import { useAuthStore } from '../store/useAuthStore'
import { anilistRequest } from '../api/anilistClient'
import { toast } from './Toaster'

interface Props {
  aniId: number | null
}

/**
 * Inline star rating widget for the Watch page. Shows 1-10 stars, fetches
 * the user's current score from AniList on mount, and saves any rating
 * change immediately via SaveMediaListEntry.
 *
 * Only renders when the user is signed into AniList.
 */
export default function StarRating({ aniId }: Props) {
  const token = useAuthStore((s) => s.auth?.token)
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  // Fetch current score from AniList on mount / when aniId changes
  useEffect(() => {
    if (!token || !aniId) {
      setLoaded(true)
      return
    }
    let cancelled = false
    anilistRequest<{ MediaList: { score: number } | null }>(
      `query ($id: Int) { MediaList(mediaId: $id) { score } }`,
      { id: aniId },
      { token },
    )
      .then((data) => {
        if (cancelled) return
        const score = data?.MediaList?.score
        if (typeof score === 'number' && score > 0) {
          // AniList scores are 0-100; convert to 0-10 display scale
          setRating(Math.round(score / 10) || 0)
        }
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => { cancelled = true }
  }, [token, aniId])

  const handleClick = useCallback(
    async (value: number) => {
      if (!token || !aniId || saving) return
      const newRating = value === rating ? 0 : value // toggle off if same
      setRating(newRating)
      setSaving(true)
      try {
        await saveListEntry(token, {
          mediaId: aniId,
          score: newRating > 0 ? newRating * 10 : undefined,
        })
        if (newRating > 0) {
          toast.success(`Rated ${newRating}/10`)
        } else {
          toast.success('Rating removed')
        }
      } catch (e) {
        // Revert on failure
        setRating(rating)
        console.warn('StarRating: failed to save score', e)
      } finally {
        setSaving(false)
      }
    },
    [token, aniId, rating, saving],
  )

  // Don't render anything unless signed in
  if (!token) return null

  // Show shimmer skeleton while fetching current score
  if (!loaded) {
    return (
      <div className="shimmer-wave rounded-md flex items-center gap-0.5 px-0.5 py-0.5" title="Loading your rating…">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((star) => (
          <Star key={star} className="h-3.5 w-3.5 text-white/[0.06]" />
        ))}
      </div>
    )
  }

  return (
    <div
      className={cn('flex items-center gap-0.5', saving && 'opacity-50 pointer-events-none')}
      title={rating > 0 ? `Your rating: ${rating}/10` : 'Rate this anime'}
    >
      {Array.from({ length: 10 }, (_, i) => i + 1).map((star) => (
        <button
          key={star}
          type="button"
          disabled={saving}
          onClick={() => handleClick(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className="transition-transform hover:scale-110 active:scale-90 disabled:opacity-50"
          aria-label={`Rate ${star} out of 10`}
        >
          <Star
            className={cn(
              'h-3.5 w-3.5 transition-colors',
              (hovered || rating) >= star
                ? 'text-amber-400 fill-amber-400'
                : 'text-white/15',
            )}
          />
        </button>
      ))}
    </div>
  )
}
