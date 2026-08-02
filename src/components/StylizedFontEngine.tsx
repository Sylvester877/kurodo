import { cn } from '../lib/utils'

interface Props {
  title: string
  englishTitle?: string | null
  japaneseTitle?: string | null
  genres: string[]
  accentColor: string
}

// Genre → typography mapping
const GENRE_STYLE = {
  fantasy: new Set(['Fantasy', 'Supernatural', 'Magic', 'Historical', 'Mystery', 'Drama', 'Romance', 'Horror', 'Psychological', 'Thriller']),
  action: new Set(['Action', 'Shounen', 'Super Power', 'Martial Arts', 'Adventure', 'Sports', 'Comedy']),
  scifi: new Set(['Sci-Fi', 'Mecha', 'Space', 'Cyberpunk']),
}

function getGenreStyle(genres: string[]): {
  fontClass: string
  weight: string
  transform: string
  tracking: string
  italic: boolean
  gradient: string
} {
  const has = (set: Set<string>) => genres.some((g) => set.has(g))

  if (has(GENRE_STYLE.fantasy) && !has(GENRE_STYLE.scifi) && !has(GENRE_STYLE.action)) {
    return {
      fontClass: 'font-jp',
      weight: 'font-black',
      transform: '',
      tracking: 'tracking-[-0.02em]',
      italic: false,
      gradient: 'from-amber-100 via-white to-amber-200',
    }
  }
  if (has(GENRE_STYLE.scifi)) {
    return {
      fontClass: 'font-mono',
      weight: 'font-bold',
      transform: 'uppercase',
      tracking: 'tracking-[0.08em]',
      italic: false,
      gradient: 'from-cyan-200 via-white to-blue-200',
    }
  }
  if (has(GENRE_STYLE.action)) {
    return {
      fontClass: 'font-display',
      weight: 'font-black',
      transform: 'uppercase',
      tracking: 'tracking-[-0.02em]',
      italic: true,
      gradient: 'from-white via-white to-slate-200',
    }
  }
  // Default: clean sans-serif
  return {
    fontClass: 'font-sans',
    weight: 'font-bold',
    transform: '',
    tracking: 'tracking-normal',
    italic: false,
    gradient: 'from-white via-white to-slate-100',
  }
}

export default function StylizedFontEngine({ title, englishTitle, japaneseTitle, genres, accentColor }: Props) {
  const style = getGenreStyle(genres)
  const displayTitle = englishTitle || title

  return (
    <div className="space-y-1">
      <h1
        className={cn(
          'text-[clamp(2rem,5vw,4.5rem)] leading-[0.95] select-none',
          style.fontClass,
          style.weight,
          style.transform,
          style.tracking,
          style.italic && 'italic',
        )}
      >
        <span
          className={cn('block bg-gradient-to-br bg-clip-text text-transparent', style.gradient)}
          style={{
            // Layered text-shadow for anime-title-card depth
            textShadow: [
              `0 0 40px ${accentColor}80`,
              `0 0 80px ${accentColor}40`,
              `0 1px 0 rgba(255,255,255,0.15)`,
              `0 2px 0 rgba(0,0,0,0.6)`,
              `0 4px 8px rgba(0,0,0,0.7)`,
              `0 8px 24px rgba(0,0,0,0.5)`,
            ].join(', '),
            // Crisp outline stroke (anime logo style)
            WebkitTextStroke: '1px rgba(0,0,0,0.35)',
            // Drop shadow beneath the stroke
            filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.6)) drop-shadow(0 2px 4px rgba(0,0,0,0.8))',
          }}
        >
          {displayTitle}
        </span>
      </h1>
      {japaneseTitle && (
        <p
          className="font-jp text-sm md:text-lg text-white/25 tracking-[0.15em] font-medium"
          style={{
            textShadow: '0 2px 8px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.8)',
            filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.4))',
          }}
        >
          {japaneseTitle}
        </p>
      )}
    </div>
  )
}
