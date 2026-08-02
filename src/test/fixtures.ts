import type { Anime } from '../types'

/**
 * Minimal but realistic Anime fixture for prop-driven smoke tests
 * (AnimeCard, AnimeGrid, ContinueWatchingRail, etc.).
 *
 * Keep this close to the actual MAL/Jikan shape so we don't silently
 * pass through a prop the production code expects but our fixture omits.
 */
export const makeAnime = (overrides: Partial<Anime> = {}): Anime => ({
  mal_id: 1,
  title: 'Cowboy Bebop',
  title_english: 'Cowboy Bebop',
  title_japanese: 'カウボーイビバップ',
  type: 'TV',
  episodes: 26,
  status: 'Finished Airing',
  duration: '24 min per ep',
  rating: 'R - 17+ (violence & profanity)',
  score: 8.75,
  scored_by: 850000,
  rank: 28,
  popularity: 39,
  members: 1_800_000,
  favorites: 75_000,
  synopsis:
    'In the year 2071, humanity has colonized several of the planets and moons of the solar system leaving the now uninhabitable surface of planet Earth behind. The Inter Solar System Police attempts to keep peace in the galaxy. ' +
    'A bounty hunter crew takes on the cases that fall through the cracks — Spike, Jet, Faye, and Ein the corgi.',
  season: 'spring',
  year: 1998,
  genres: [
    { mal_id: 1, name: 'Action' },
    { mal_id: 2, name: 'Sci-Fi' },
    { mal_id: 24, name: 'Space' },
  ],
  studios: [{ mal_id: 11, name: 'Sunrise' }],
  themes: [],
  demographics: [],
  images: {
    jpg: {
      image_url: 'https://cdn.myanimelist.net/images/anime/4/19644l.jpg',
      small_image_url: 'https://cdn.myanimelist.net/images/anime/4/19644s.jpg',
      large_image_url: 'https://cdn.myanimelist.net/images/anime/4/19644.jpg',
    },
    webp: {
      image_url: 'https://cdn.myanimelist.net/images/anime/4/19644l.webp',
      small_image_url: 'https://cdn.myanimelist.net/images/anime/4/19644s.webp',
      large_image_url: 'https://cdn.myanimelist.net/images/anime/4/19644.webp',
    },
  },
  trailer: {
    youtube_id: '2OKx0YIst0o',
    url: 'https://www.youtube.com/watch?v=2OKx0YIst0o',
    embed_url: 'https://www.youtube.com/embed/2OKx0YIst0o',
    images: {
      image_url: null,
      small_image_url: null,
      medium_image_url: null,
      large_image_url: null,
      maximum_image_url: null,
    },
  },
  aired: { from: '1998-04-03T00:00:00+00:00', to: '1999-04-24T00:00:00+00:00', string: 'Apr 1998 – Apr 1999' },
  ...overrides,
})
