import { memo } from 'react'
import AnimeCard from './AnimeCard'
import type { Anime } from '../types'

interface Props {
  animes: Anime[]
  title?: string
  subtitle?: string
}

export default memo(function AnimeGrid({ animes, title, subtitle }: Props) {
  return (
    <div>
      {(title || subtitle) && (
        <div className="mb-6">
          {title && (
            <div className="flex items-center gap-3 mb-1">
              <div className="h-1 w-8 rounded-full bg-primary" />
              <h2 className="text-2xl font-bold text-white">{title}</h2>
            </div>
          )}
          {subtitle && <p className="text-muted-foreground text-sm mt-1 ml-11">{subtitle}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-5 contain-auto">
        {animes.map((anime) => (
          <AnimeCard key={anime.mal_id} anime={anime} />
        ))}
      </div>
    </div>
  )
})