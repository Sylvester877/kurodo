export interface Anime {
  mal_id: number
  title: string
  title_english: string | null
  title_japanese: string | null
  synopsis: string | null
  score: number | null
  scored_by: number | null
  rank: number | null
  popularity: number | null
  members: number | null
  favorites: number | null
  images: {
    jpg: {
      image_url: string
      small_image_url: string
      large_image_url: string
    }
    webp: {
      image_url: string
      small_image_url: string
      large_image_url: string
    }
  }
  trailer: {
    youtube_id: string | null
    url: string | null
    embed_url: string | null
    images: {
      image_url: string | null
      small_image_url: string | null
      medium_image_url: string | null
      large_image_url: string | null
      maximum_image_url: string | null
    }
  }
  type: string
  status: string
  episodes: number | null
  duration: string | null
  rating: string | null
  aired: {
    from: string | null
    to: string | null
    string: string | null
  }
  season: string | null
  year: number | null
  genres: { mal_id: number; name: string }[]
  studios: { mal_id: number; name: string }[]
  themes: { mal_id: number; name: string }[]
  demographics: { mal_id: number; name: string }[]
}

export interface AnimeSearchResponse {
  data: Anime[]
  pagination: {
    last_visible_page: number
    has_next_page: boolean
    items: { count: number; total: number; per_page: number }
    current_page: number
  }
}

export interface Genre {
  mal_id: number
  name: string
  count: number
}

export interface Episode {
  mal_id: number
  title: string
  title_japanese: string | null
  title_romanji: string | null
  aired: string | null
  score: number | null
  filler: boolean
  recap: boolean
  forum_url: string | null
}

export interface AnimeEpisodeResponse {
  data: Episode[]
  pagination: {
    last_visible_page: number
    has_next_page: boolean
  }
}

/** HLS quality preference (persisted across sessions). */
export type QualityPref = 'auto' | '1080p' | '720p' | '480p' | '360p'

/** A single download entry tracked by Electron's download manager. */
export interface DownloadEntry {
  id: number
  url: string
  filename: string
  savePath: string
  state: 'preparing' | 'downloading' | 'completed' | 'cancelled' | 'interrupted'
  percent: number
  received: number
  total: number
  startTime: number
  endTime: number | null
}

/** Shape of the electronAPI exposed by preload.cjs (only present in Electron). */
export interface ElectronAPI {
  isElectron: true
  /** Backend origin (e.g. http://localhost:5173) for absolute API/image URLs. */
  backendOrigin?: string
  versions: { electron: string; chrome: string; node: string }
  platform: NodeJS.Platform
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  openExternal: (url: string) => void
  onUpdateAvailable: (callback: (info: { version: string; releaseDate: string }) => void) => (() => void)
  onUpdateProgress: (callback: (data: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => (() => void)
  onUpdateReady: (callback: (info: { version: string; releaseDate: string }) => void) => void
  removeUpdateReadyListener: () => void
  installUpdate: () => void
  getAppVersion: () => string
  getUpdateFeedUrl: () => string
  setUpdateFeedUrl: (url: string) => void
  checkForUpdates: () => void
  onUpdateChecking: (callback: () => void) => (() => void)
  onUpdateNotAvailable: (callback: () => void) => (() => void)
  onUpdateError: (callback: (message: string) => void) => (() => void)
  getDownloadHistory: () => DownloadEntry[]
  clearDownloadHistory: () => void
  onDownloadHistoryUpdate: (callback: (history: DownloadEntry[]) => void) => (() => void)
  openDownloadFile: (savePath: string) => void
  openDownloadFolder: (savePath: string) => void
  startDownload: (url: string, callback: (data: DownloadEntry) => void) => (() => void)
  /** Get saved AniList credentials from the Electron disk file (userData). */
  getAnilistCredentials: () => { clientId: string; clientSecret: string }
  /** Persist AniList credentials to disk so they survive reinstalls. */
  setAnilistCredentials: (clientId: string, clientSecret: string) => Promise<{ success: boolean; error?: string }>
  /** Clear the renderer cache and storage (used by the error page hard reload). */
  clearCache: () => Promise<{ success: boolean; error?: string }>
  /** True when this window was recreated/reloaded after a renderer crash
   *  within the last `maxAgeMs` (default 15s). Pages use this to avoid
   *  auto-playing on boot. */
  wasRecentlyRecovered: (maxAgeMs?: number) => boolean
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}