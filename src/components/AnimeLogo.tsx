// AnimeLogo — the anikage.cc logo pipeline as a component.
//
// Behavior (spec §3):
//  • FIXED box per variant (hero 80/130px, watch 32/40px, qtip 48px) — no
//    layout shift (CLS = 0) whether the logo loads or not
//  • wordmark renders INSTANTLY (text, zero network) in the box
//  • TVDB clearlogo resolves first (['tvdbArt'] persisted 24h); TMDB logo
//    (['tmdbLogo', title]) is the fallback — both usually warm already
//  • when the img decodes it pops in: scale .96→1, y 8→0, blur 6→0,
//    250-450ms (`--ease-spring`), wordmark swaps out
//  • on error: keep the wordmark, silent retry after 10 min (art appears
//    upstream quickly for new shows — never toast, never blank)
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTvdbArt, proxifyTvdbArt } from '../api/tvdbArt'
import { useSettings } from '../store/useSettings'
import { cn } from '../lib/utils'

type Variant = 'hero' | 'watch' | 'qtip'

interface Props {
  titleEn: string | null
  romaji: string
  malId?: number | null
  anilistId?: number | null
  variant?: Variant
  className?: string
  /** Text-shadow strength for the wordmark fallback (hero looks best dark). */
  wordmarkClassName?: string
}

const BOX: Record<Variant, string> = {
  hero: 'h-[64px] sm:h-[80px] lg:h-[130px]',
  watch: 'h-[32px] md:h-[40px]',
  qtip: 'h-[48px]',
}

const MAXW: Record<Variant, string> = {
  hero: 'max-w-[min(560px,72vw)]',
  watch: 'max-w-[320px]',
  qtip: 'max-w-[260px]',
}

const RETRY_MS = 10 * 60 * 1000

export default function AnimeLogo({
  titleEn,
  romaji,
  malId,
  anilistId,
  variant = 'hero',
  className,
  wordmarkClassName,
}: Props) {
  const queryClient = useQueryClient()
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const [failedAt, setFailedAt] = useState<number | null>(null)
  const [imgOk, setImgOk] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Silent retry ticker — only ticks while a failure is pending.
  useEffect(() => {
    if (!failedAt) return
    const left = RETRY_MS - (Date.now() - failedAt)
    const t = setTimeout(() => setNow(Date.now()), Math.max(1000, left))
    return () => clearTimeout(t)
  }, [failedAt, now])

  // Reset image state when the resolved candidate changes.
  useEffect(() => { setImgOk(false) }, [malId, anilistId, titleEn, romaji])

  // 1st choice: TVDB clearlogo (direct CDN URL via /img proxy).
  const { data: tvdbArt } = useTvdbArt({ malId, anilistId })
  // 2nd choice: TMDB logo (existing persisted cache).
  const title = titleEn || romaji
  const tmdbLogo = queryClient.getQueryData<string | null>(['tmdbLogo', title]) ?? null

  const retryWindowOpen = !failedAt || Date.now() - failedAt >= RETRY_MS
  const tvdbLogo = retryWindowOpen ? tvdbArt?.clearlogo ?? null : null
  const candidate = useMemo(
    () => proxifyTvdbArt(tvdbLogo) ?? tmdbLogo ?? null,
    [tvdbLogo, tmdbLogo],
  )
  const showImg = !!candidate && (imgOk || retryWindowOpen)

  return (
    <div className={cn('relative w-full', BOX[variant], MAXW[variant], className)}>
      {/* Wordmark — instant paint, always mounted as the underlay */}
      <h1
        className={cn(
          'hero-wordmark absolute inset-0 flex items-center text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight transition-opacity duration-200',
          showImg && imgOk ? 'opacity-0' : 'opacity-100',
          wordmarkClassName,
        )}
        style={{ textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}
      >
        {titleEn || romaji}
      </h1>
      {/* Logo img — pops in over the wordmark once decoded */}
      {candidate && (
        <img
          key={candidate}
          src={candidate}
          alt={titleEn || romaji}
          className={cn(
            'absolute inset-0 w-auto max-w-full max-h-full object-contain object-left drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]',
            showImg ? 'opacity-100' : 'opacity-0',
            !reduceMotion && 'logo-pop',
          )}
          loading="eager"
          fetchPriority="high"
          decoding="async"
          onLoad={() => setImgOk(true)}
          onError={() => { setImgOk(false); setFailedAt(Date.now()) }}
        />
      )}
    </div>
  )
}
