// Adapters between AniList's `FeedMedia` and our Jikan-shaped `Anime` type,
// so existing components (AnimeCard, watchlist store, etc.) keep working.

import type { FeedMedia } from '../api/anilist'
import type { Anime } from '../types'

/**
 * Convert an AniList FeedMedia → our Anime shape.
 * Cover URLs use AniList's higher-res `extraLarge` (460×651) over Jikan's
 * 400×600 — noticeably sharper on retina displays.
 */
export function feedMediaToAnime(m: FeedMedia): Anime | null {
  if (!m.idMal) return null // we navigate by mal_id

  const coverLarge = m.coverImage.extraLarge || m.coverImage.large || ''
  // AniList's API only exposes large + extraLarge; no medium. For the
  // "small" slot fall back to large (which is ~460px on their CDN).
  const coverSmall = m.coverImage.large || coverLarge
  const banner = m.bannerImage || coverLarge

  return {
    mal_id: m.idMal,
    title: m.title.romaji || m.title.english || '',
    title_english: m.title.english,
    title_japanese: m.title.native,
    synopsis: m.description
      ? m.description.replace(/<[^>]+>/g, '').trim()
      : null,
    score: m.averageScore ? m.averageScore / 10 : null,
    scored_by: null,
    rank: null,
    popularity: null,
    members: null,
    favorites: null,
    images: {
      jpg: { image_url: coverLarge, small_image_url: coverSmall, large_image_url: coverLarge },
      webp: { image_url: coverLarge, small_image_url: coverSmall, large_image_url: coverLarge },
    },
    trailer: {
      youtube_id: m.trailer?.site === 'youtube' ? m.trailer.id : null,
      url: m.trailer?.site === 'youtube'
        ? `https://youtube.com/watch?v=${m.trailer.id}` : null,
      embed_url: m.trailer?.site === 'youtube'
        ? `https://www.youtube.com/embed/${m.trailer.id}` : null,
      images: {
        image_url: banner,
        small_image_url: banner,
        medium_image_url: banner,
        large_image_url: banner,
        maximum_image_url: banner,
      },
    },
    type: m.format || 'TV',
    status: m.status || '',
    episodes: m.episodes,
    duration: m.duration ? `${m.duration} min per ep` : null,
    rating: null,
    aired: { from: null, to: null, string: null },
    season: m.season ? m.season.toLowerCase() : null,
    year: m.seasonYear,
    genres: m.genres.map((g, i) => ({ mal_id: i, name: g })),
    studios: [],
    themes: [],
    demographics: [],
  }
}

/** Map a list, dropping entries that lack a MAL id. */
export function feedToAnimeList(items: FeedMedia[]): Anime[] {
  const out: Anime[] = []
  for (const m of items) {
    const a = feedMediaToAnime(m)
    if (a) out.push(a)
  }
  return out
}
