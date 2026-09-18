/**
 * Publisher-only chapters ("notice chapters").
 *
 * MangaDex can't host chapters that belong to a publisher's own platform
 * (Manga UP!, MANGA Plus, Webnovel, TappyToon, …). For those it stores a link
 * out plus — in place of pages — a single notice image that says the chapter
 * needs a paid subscription. Rendering that image as if it were the chapter is
 * how users end up staring at a white "EXTERNAL CHAPTER" card for *every*
 * chapter of a licensed title (My Dress-Up Darling: 220/220 chapters are
 * Manga UP! notices).
 *
 * These helpers are deliberately tolerant of missing fields: chapter payloads
 * are cached in localStorage/React Query, so entries written by an older build
 * won't carry the flags and must still be judged sensibly.
 */

export interface ChapterLike {
  pages?: number | null
  /** Authoritative backend verdict — present on chapters fetched after the flag shipped. */
  readable?: boolean | null
  /** Publisher link-out. Present on every publisher chapter MangaDex can't host. */
  externalUrl?: string | null
  official?: boolean | null
  publisher?: string | null
  isUnavailable?: boolean | null
  scanGroup?: string | null
}

/** True when MangaDex has nothing readable to serve for this chapter. */
export function isPublisherNotice(ch: ChapterLike | null | undefined): boolean {
  if (!ch) return false
  // Trust the backend verdict when it's there.
  if (ch.readable === false) return true
  if (ch.isUnavailable) return true
  const pages = ch.pages ?? 0
  if (ch.externalUrl) return pages <= 1
  // No flag (older cached payload): a publisher-group entry with no real page
  // set is still unreadable.
  if (ch.official && pages <= 1) return true
  return false
}

/** A chapter the reader can actually display. */
export function isReadableChapter(ch: ChapterLike | null | undefined): boolean {
  if (!ch) return false
  if (ch.readable === false) return false
  if (ch.isUnavailable) return false
  return (ch.pages ?? 0) > 0 && !isPublisherNotice(ch)
}

/** Human label for who hosts a notice chapter. */
export function publisherLabel(ch: ChapterLike | null | undefined): string | null {
  if (!ch) return null
  return ch.publisher || (isPublisherNotice(ch) ? ch.scanGroup || null : null)
}
