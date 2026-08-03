import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock, Flame, Tv2, Users, User, ExternalLink, LogIn, Play,
  Calendar, Trophy, Sparkles, ChevronRight,  Heart,
  BookOpen, Zap, Medal, Award,
} from 'lucide-react'
import AnimeCard from '../components/AnimeCard'
import { useAuthStore } from '../store/useAuthStore'
import { useWatchListStore } from '../store/useWatchListStore'
import { useTitle } from '../hooks/useTitle'
import { cn, getImageUrl, proxifyImgUrl } from '../lib/utils'
import {
  statsByWindow, formatMinutes, topGenres, topStudios,
  buildHeatmap, currentStreak, buildProgressList,
} from '../lib/stats'
import StatTile from '../components/profile/StatTile'
import GenreDonut from '../components/profile/GenreDonut'
import Heatmap from '../components/profile/Heatmap'
import StaggerCard from '../components/StaggerCard'
import { getClientId, getLoginUrl } from '../api/anilistAuth'
import { useProfileCustomization, FRAMES, OVERLAYS } from '../store/useProfileCustomization'

type Tab = 'watching' | 'planning' | 'completed' | 'all'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'watching',  label: 'Watching' },
  { id: 'planning',  label: 'Plan to watch' },
  { id: 'completed', label: 'Completed' },
  { id: 'all',       label: 'All' },
]

// ─── Achievement badges (AniDap-style) ────────────────────────────
interface Badge {
  id: string
  icon: React.ReactNode
  label: string
  description: string
  earned: boolean
  color: string
}

function computeBadges(
  auth: ReturnType<typeof useAuthStore.getState>['auth'],
  watchlistLen: number,
  streak: number,
): Badge[] {
  const al = auth?.user
  return [
    {
      id: 'century',
      icon: <Zap className="h-4 w-4" />,
      label: 'Century',
      description: '100 episodes watched',
      earned: (al?.episodesWatched ?? 0) >= 100,
      color: 'text-amber-400',
    },
    {
      id: 'marathon',
      icon: <Trophy className="h-4 w-4" />,
      label: 'Marathon',
      description: '500 episodes watched',
      earned: (al?.episodesWatched ?? 0) >= 500,
      color: 'text-emerald-400',
    },
    {
      id: 'binge',
      icon: <Flame className="h-4 w-4" />,
      label: 'Binge',
      description: '1,000+ episodes',
      earned: (al?.episodesWatched ?? 0) >= 1000,
      color: 'text-rose-400',
    },
    {
      id: 'streak7',
      icon: <Flame className="h-4 w-4" />,
      label: '7-Day Streak',
      description: '7 consecutive days',
      earned: streak >= 7,
      color: 'text-orange-400',
    },
    {
      id: 'streak30',
      icon: <Medal className="h-4 w-4" />,
      label: 'Monthly Streak',
      description: '30 consecutive days',
      earned: streak >= 30,
      color: 'text-yellow-400',
    },
    {
      id: 'collector',
      icon: <BookOpen className="h-4 w-4" />,
      label: 'Collector',
      description: '50+ shows in library',
      earned: watchlistLen >= 50,
      color: 'text-purple-400',
    },
    {
      id: 'completionist',
      icon: <Award className="h-4 w-4" />,
      label: 'Completionist',
      description: '25 shows finished',
      earned: (al?.animeCount ?? 0) >= 25,
      color: 'text-blue-400',
    },
    {
      id: 'follower',
      icon: <Heart className="h-4 w-4" />,
      label: 'Popular',
      description: '50+ AniList followers',
      earned: (al?.followers ?? 0) >= 50,
      color: 'text-pink-400',
    },
  ]
}

// ─── Badge pill component ─────────────────────────────────────────
function BadgePill({ badge }: { badge: Badge }) {
  return (
    <div
      className={cn(
        'group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all',
        badge.earned
          ? 'bg-white/[0.06] border-white/10 hover:border-white/20 hover:bg-white/[0.10]'
          : 'bg-transparent border-white/[0.04] opacity-30 grayscale',
      )}
      title={badge.earned ? badge.description : `${badge.description} (locked)`}
    >
      <span className={cn(badge.earned ? badge.color : 'text-white/25')}>
        {badge.icon}
      </span>
      <span className={cn(badge.earned ? 'text-white/80' : 'text-white/25')}>
        {badge.label}
      </span>
      {badge.earned && (
        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.6)]" />
      )}
    </div>
  )
}

// ─── Format big numbers ───────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (n == null || isNaN(n) || n < 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

// ─────────────────────────────────────────────────────────────────
export default function Profile() {
  const auth = useAuthStore((s) => s.auth)
  const watchlist = useWatchListStore((s) => s.watchlist)
  const watchedEpisodes = useWatchListStore((s) => s.watchedEpisodes)
  const watchHistory = useWatchListStore((s) => s.watchHistory)
  const continueWatching = useWatchListStore((s) => s.continueWatching)
  const [tab, setTab] = useState<Tab>('watching')

  useTitle(auth ? auth.user.name : 'Profile')

  // ─── Derived stats ──────────────────────────────────────────────
  const stats = useMemo(
    () => statsByWindow(watchHistory, watchlist),
    [watchHistory, watchlist],
  )
  const heatmap = useMemo(
    () => buildHeatmap(watchHistory, 14),
    [watchHistory],
  )
  const streak = useMemo(() => currentStreak(watchHistory), [watchHistory])
  const genres = useMemo(
    () => topGenres(watchHistory, watchlist, 8),
    [watchHistory, watchlist],
  )
  const studios = useMemo(() => topStudios(watchlist, 6), [watchlist])
  const inProgress = useMemo(
    () => buildProgressList(watchlist, watchedEpisodes, continueWatching),
    [watchlist, watchedEpisodes, continueWatching],
  )

  // Tab filtering — based on watched/total per anime
  const tabbed = useMemo(() => {
    return watchlist.map((a) => {
      const watched = (watchedEpisodes[a.mal_id] ?? []).length
      const total = a.episodes ?? 0
      const pct = total > 0 ? (watched / total) * 100 : 0
      let status: Tab
      if (watched === 0) status = 'planning'
      else if (total > 0 && pct >= 100) status = 'completed'
      else status = 'watching'
      return { anime: a, watched, total, pct, status }
    })
  }, [watchlist, watchedEpisodes])

  const visible = tab === 'all' ? tabbed : tabbed.filter((t) => t.status === tab)
  const tabCounts = useMemo(
    () => ({
      watching:  tabbed.filter((t) => t.status === 'watching').length,
      planning:  tabbed.filter((t) => t.status === 'planning').length,
      completed: tabbed.filter((t) => t.status === 'completed').length,
      all:       tabbed.length,
    }),
    [tabbed],
  )

  // ─── Badges ─────────────────────────────────────────────────────
  const badges = useMemo(
    () => computeBadges(auth, watchlist.length, streak),
    [auth, watchlist.length, streak],
  )
  const earnedBadges = useMemo(() => badges.filter((b) => b.earned), [badges])

  // ─── Profile customization ──────────────────────────────────────
  const avatarFrame = useProfileCustomization((s) => s.avatarFrame)
  const bannerOverlay = useProfileCustomization((s) => s.bannerOverlay)
  const activeFrame = FRAMES.find((f) => f.id === avatarFrame)
  const activeOverlay = OVERLAYS.find((o) => o.id === bannerOverlay)

  // ─── Banner resolution ──────────────────────────────────────────
  const profileColor = auth?.user.profileColor ?? '#7c3aed'
  const bannerUrl = auth?.user.bannerImage
  const showSignInBanner = !auth && !!getClientId()

  return (
    <div className="pt-20 pb-12 min-h-screen">
      <div className="max-w-[1600px] mx-auto px-4">

        {/* ══════════════════ AniList-style live profile banner ══════════════════ */}
        <div className={cn(
          'relative rounded-2xl overflow-hidden mb-5 group/banner profile-frame-glow',
          activeOverlay?.className,
        )}
          style={{ '--glow-color': `${profileColor}44` } as React.CSSProperties}>
          {/* Background image layer — AniList banner with Ken Burns */}
          <div className="absolute inset-0 bg-black/50 z-0" />
          {bannerUrl ? (
            <img
              src={proxifyImgUrl(bannerUrl)}
              alt=""
              className="absolute inset-0 w-[105%] h-[105%] object-cover z-[-1] banner-ken-burns -top-[2.5%] -left-[2.5%]"
              loading="eager"
            />
          ) : null}
          {/* Shimmer sweep — diagonal light streak */}
          <div aria-hidden className="absolute inset-0 z-[1] pointer-events-none">
            <div className="banner-shimmer-sweep absolute top-0 left-0 w-[60%] h-[200%]"
              style={{
                background: `linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.04) 48%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 52%, transparent 60%)`,
              }} />
          </div>
          {/* Floating particles */}
          <div aria-hidden className="absolute inset-0 z-[1] pointer-events-none overflow-hidden">
            <div className="banner-particle-1 absolute bottom-0 left-[15%] w-1 h-1 rounded-full bg-white/30" />
            <div className="banner-particle-2 absolute bottom-0 left-[45%] w-1.5 h-1.5 rounded-full bg-white/25" />
            <div className="banner-particle-3 absolute bottom-0 left-[75%] w-1 h-1 rounded-full bg-white/20" />
            <div className="banner-particle-1 absolute bottom-0 left-[30%] w-0.5 h-0.5 rounded-full bg-primary/40" style={{ animationDelay: '3s' }} />
            <div className="banner-particle-2 absolute bottom-0 left-[60%] w-1 h-1 rounded-full bg-primary/30" style={{ animationDelay: '6s' }} />
          </div>
          {/* Gradient overlays for readability */}
          <div
            aria-hidden
            className="absolute inset-0 z-0 pointer-events-none"
            style={{
              background: `linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.85) 100%), linear-gradient(90deg, rgba(0,0,0,0.7) 0%, transparent 50%, rgba(0,0,0,0.4) 100%)`,
            }}
          />
          {/* Profile color accent glow */}
          {!bannerUrl && (
            <div
              aria-hidden
              className="absolute inset-0 z-0"
              style={{
                background: `linear-gradient(135deg, ${profileColor}66 0%, ${profileColor}26 50%, #0a0a0a 100%)`,
              }}
            />
          )}
          {/* Radial glow */}
          <div
            aria-hidden
            className="absolute inset-0 z-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at top right, ${profileColor}33, transparent 60%)`,
            }}
          />

          {/* Content row — avatar + info overlaid on banner */}
          <div className="relative z-10 px-5 pb-5 pt-8 sm:pt-12">
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 sm:gap-5">
              {/* Avatar — larger, with customizable frame */}
              <div className="relative shrink-0">
                <div
                  className={cn(
                    'h-24 w-24 sm:h-28 sm:w-28 rounded-2xl shadow-2xl overflow-hidden transition-all duration-500',
                    avatarFrame ? activeFrame?.className : 'ring-[3px] ring-white/20',
                  )}
                  style={avatarFrame && activeFrame?.style
                    ? activeFrame.style
                    : { boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)' }
                  }
                >
                  {auth?.user.avatar ? (
                    <img
                      src={proxifyImgUrl(auth.user.avatar)}
                      alt={auth.user.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-white/[0.06] grid place-items-center">
                      <User className="h-12 w-12 text-white/30" />
                    </div>
                  )}
                </div>
                {/* Online indicator — breathing glow */}
                {auth && (
                  <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-emerald-500 border-2 border-black ring-1 ring-emerald-500/30 status-breathe" />
                )}
              </div>

              {/* Name + meta */}
              <div className="flex-1 min-w-0 pb-1">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight tracking-tight drop-shadow-lg">
                  {auth?.user.name ?? 'Your dashboard'}
                </h1>

                {/* Meta row: AniList link + follower counts */}
                <div className="flex items-center gap-3 flex-wrap mt-1.5">
                  {auth ? (
                    <>
                      <span className="glass-pill text-emerald-400 border-emerald-500/30 bg-emerald-500/15 text-[10px] font-bold">
                        AniList synced
                      </span>
                      <a
                        href={`https://anilist.co/user/${encodeURIComponent(auth.user.name)}`}
                        target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-white/60 hover:text-primary transition-colors"
                      >
                        anilist.co/{auth.user.name}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                      {/* Follower / following counts (capped at 50+ — AniList no
                          longer exposes pageInfo.total for these connections) */}
                      <span className="text-[11px] text-white/40 select-none">|</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-white/60">
                        <Heart className="h-3 w-3 text-rose-400" />
                        {auth.user.followers >= 50 ? '50+' : fmt(auth.user.followers)} followers
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-white/60">
                        <Users className="h-3 w-3 text-blue-400" />
                        {auth.user.following >= 50 ? '50+' : fmt(auth.user.following)} following
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-white/50">
                      Local profile · sign in with AniList to sync across devices
                    </span>
                  )}
                </div>
              </div>

              {/* Streak badge (top-right) */}
              {streak > 0 && (
                <div className="hidden sm:flex items-center gap-2 rounded-xl bg-accent/15 border border-accent/30 px-3 py-2">
                  <Flame className="h-4 w-4 text-accent fill-accent" />
                  <div className="leading-tight">
                    <p className="text-[10px] uppercase tracking-wider text-accent font-bold">Streak</p>
                    <p className="text-sm font-extrabold text-white">{streak} {streak === 1 ? 'day' : 'days'}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Bio section (AniDap-style) */}
            {auth?.user.about && (
              <div className="mt-4 max-w-2xl">
                <p className="text-[13px] text-white/70 leading-relaxed line-clamp-3 sm:line-clamp-none">
                  {auth.user.about}
                </p>
              </div>
            )}

            {/* Sign-in prompt */}
            {showSignInBanner && (
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <a
                  href={getLoginUrl() ?? '#'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Sign in with AniList
                </a>
                <Link to="/admin" className="text-[10px] text-white/40 hover:text-white underline transition-colors">
                  Having trouble?
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* ══════════════════ Stat tiles ══════════════════ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <StatTile
            icon={<Clock className="h-4 w-4 text-primary" />}
            label="Watch time · all-time"
            value={formatMinutes(stats.allTime.minutes)}
            sub={`${stats.allTime.episodes} episodes`}
            accent="primary"
          />
          <StatTile
            icon={<Calendar className="h-4 w-4 text-emerald-400" />}
            label="This month"
            value={formatMinutes(stats.thisMonth.minutes)}
            sub={`${stats.thisMonth.episodes} episodes`}
            accent="emerald"
          />
          <StatTile
            icon={<Sparkles className="h-4 w-4 text-accent" />}
            label="This week"
            value={formatMinutes(stats.thisWeek.minutes)}
            sub={`${stats.thisWeek.shows} shows`}
            accent="accent"
          />
          <StatTile
            icon={<Trophy className="h-4 w-4 text-primary" />}
            label="Shows in list"
            value={watchlist.length}
            sub={`${tabCounts.completed} completed · ${tabCounts.watching} active`}
            accent="primary"
          />
        </div>

        {/* ══════════════════ AniList stats row (when authed) ══════════════════ */}
        {auth && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-5">
            <div className="glass-card rounded-2xl px-4 py-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">AniList</p>
              <p className="text-lg font-extrabold text-white tabular-nums">
                {fmt(auth.user.episodesWatched)}
              </p>
              <p className="text-[10px] text-white/50">episodes</p>
            </div>
            <div className="glass-card rounded-2xl px-4 py-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">Completed</p>
              <p className="text-lg font-extrabold text-white tabular-nums">
                {fmt(auth.user.animeCount)}
              </p>
              <p className="text-[10px] text-white/50">anime</p>
            </div>
            <div className="glass-card rounded-2xl px-4 py-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">Watch time</p>
              <p className="text-lg font-extrabold text-white tabular-nums">
                {formatMinutes(auth.user.minutesWatched)}
              </p>
              <p className="text-[10px] text-white/50">on AniList</p>
            </div>
            <div className="glass-card rounded-2xl px-4 py-3 text-center hidden sm:block">
              <p className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">Followers</p>
              <p className="text-lg font-extrabold text-white tabular-nums">
                {auth.user.followers >= 50 ? '50+' : fmt(auth.user.followers)}
              </p>
              <p className="text-[10px] text-white/50">on AniList</p>
            </div>
          </div>
        )}

        {/* ══════════════════ Achievement badges (AniDap-style) ══════════════════ */}
        <section className="glass-card rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Award className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Achievements
            </h2>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {earnedBadges.length}/{badges.length} earned
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <BadgePill key={b.id} badge={b} />
            ))}
          </div>
        </section>

        {/* ══════════════════ Two-column: heatmap+genres / continue+studios ══════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 mb-5">
          {/* LEFT — heatmap + genre donut */}
          <div className="space-y-5 min-w-0">
            <section className="glass-card rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Flame className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Watching activity
                </h2>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  Last 14 weeks
                </span>
              </div>
              <Heatmap cells={heatmap} />
            </section>

            <section className="glass-card rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Tv2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Genre breakdown
                </h2>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  By episodes watched
                </span>
              </div>
              <GenreDonut entries={genres} />
            </section>
          </div>

          {/* RIGHT — currently watching + studios */}
          <div className="space-y-5">
            <section className="glass-card rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Play className="h-4 w-4 text-primary fill-primary" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Continue watching
                </h2>
              </div>
              {inProgress.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  Nothing in progress. Start an episode to populate this.
                </p>
              ) : (
                <ul data-lenis-prevent className="space-y-2 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
                  {inProgress.slice(0, 8).map((p) => (
                    <li key={p.anime.mal_id}>
                      <Link
                        to={`/watch/${p.anime.mal_id}?ep=${p.lastEpisode}`}
                        className="group flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] border border-transparent hover:border-primary/30 transition-all"
                      >
                        <div className="relative h-14 w-10 shrink-0 rounded overflow-hidden bg-black/40">
                          <img
                            src={getImageUrl(p.anime)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-white truncate group-hover:text-primary transition-colors">
                            {p.anime.title_english || p.anime.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="h-1 flex-1 rounded-full bg-white/8 overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${p.pct}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
                              {p.watched}{p.total ? `/${p.total}` : ''}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="glass-card rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Top studios
                </h2>
              </div>
              {studios.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  Add anime to your list to see your favorite studios.
                </p>
              ) : (
                <ul className="space-y-2">
                  {studios.map((s) => (
                    <li key={s.key}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-white truncate">{s.key}</span>
                        <span className="font-mono text-muted-foreground tabular-nums">
                          {s.count}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-accent to-primary transition-all"
                          style={{ width: `${s.pct}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        {/* ══════════════════ Library with status tabs ══════════════════ */}
        <section className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Tv2 className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                My library
              </h2>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {TABS.map((t) => {
                const count = tabCounts[t.id]
                const isActive = tab === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                      isActive
                      ? 'bg-primary text-white border-primary shadow-[0_4px_12px_-4px_hsl(245,75%,60%,0.4)]'
                      : 'bg-white/[0.04] text-white/70 border-white/8 hover:bg-white/[0.08] hover:text-white hover:border-primary/30',
                    )}
                  >
                    {t.label}
                    <span className={cn(
                      'text-[10px] font-mono tabular-nums px-1 rounded',
                      isActive ? 'bg-white/15' : 'text-muted-foreground',
                    )}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="py-12 text-center">
              <Tv2 className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-sm text-white/70 font-semibold">
                Nothing here yet
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {tab === 'completed'
                  ? 'Finish a show to see it here'
                  : tab === 'planning'
                    ? 'Add anime to plan to watch'
                    : 'Mark an episode watched to populate this'}
              </p>
              <Link
                to="/browse"
                className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90"
              >
                Browse anime
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-6">
              {visible.map(({ anime, watched, total, pct }, i) => (
                <StaggerCard key={anime.mal_id} index={i}>
                  <AnimeCard
                    anime={anime}
                    badge={watched > 0 && total > 0 ? `${watched}/${total}` : undefined}
                  />
                  {watched > 0 && total > 0 && (
                    <div className="mt-0.5 px-0.5">
                      <div className="h-1 rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-primary/60 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </StaggerCard>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
