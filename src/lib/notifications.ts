// Browser notifications for watchlisted shows that are about to air.
//
// Architecture: in-tab Notification API (no service worker subscription, no
// VAPID keys). Works whenever the app has at least one tab open. The
// scheduler ticks every minute; matches the watchlist against AniList's
// `airingSchedules` query for the next ~2 hours; fires a notification when
// an episode is within `LEAD_MINUTES` of airing.

import { queryClient } from './queryClient'
import { getAiringSchedule, type AiringSchedule } from '../api/anilist'
import { useWatchListStore } from '../store/useWatchListStore'

const SENT_KEY = 'kurodo-notif-sent'
const LEAD_MINUTES = 5     // how early to notify
const TICK_MS = 60_000     // re-check every minute
const SCHEDULE_LOOKAHEAD_HOURS = 2

// ───────── Permission ─────────
export type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

export function getPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission as PermissionState
}

/** Prompt the user for notification permission. Returns the new state. */
export async function requestPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  const result = await Notification.requestPermission()
  return result as PermissionState
}

// ───────── Dedup: "have we already notified about this airing?" ─────────
interface SentRecord { [key: string]: number /* unix-sec airingAt */ }

function loadSent(): SentRecord {
  try {
    const raw = localStorage.getItem(SENT_KEY)
    return raw ? (JSON.parse(raw) as SentRecord) : {}
  } catch { return {} }
}

function saveSent(rec: SentRecord) {
  // Drop entries older than 7 days
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400
  const pruned: SentRecord = {}
  for (const [k, v] of Object.entries(rec)) {
    if (v > cutoff) pruned[k] = v
  }
  try { localStorage.setItem(SENT_KEY, JSON.stringify(pruned)) } catch { /* quota */ }
}

function notifKey(malId: number, episode: number): string {
  return `${malId}:${episode}`
}

// ───────── Core ─────────
/**
 * Check the schedule once and fire notifications for matches.
 * Cached for 10 minutes via React Query (we reuse Schedule page's cache key).
 */
async function checkOnce(): Promise<void> {
  if (getPermission() !== 'granted') return

  const watchlist = useWatchListStore.getState().watchlist
  if (watchlist.length === 0) return
  const malIds = new Set(watchlist.map((a) => a.mal_id))

  const nowSec = Math.floor(Date.now() / 1000)
  const aheadSec = nowSec + SCHEDULE_LOOKAHEAD_HOURS * 3600

  // Pull the schedule via React Query so it's deduped with anything the
  // Schedule page already loaded.
  let items: AiringSchedule[] = []
  try {
    const res = await queryClient.fetchQuery({
      queryKey: ['notif-schedule', Math.floor(nowSec / 600)], // 10-min bucket
      queryFn: () => getAiringSchedule(nowSec, aheadSec, 1, 50),
      staleTime: 10 * 60 * 1000,
    })
    items = res.items
  } catch {
    return // network down / rate-limited; skip this tick
  }

  const sent = loadSent()
  let changed = false

  for (const item of items) {
    const malId = item.media.idMal
    if (!malId || !malIds.has(malId)) continue

    const secsUntil = item.airingAt - Math.floor(Date.now() / 1000)
    if (secsUntil < -60) continue // already aired more than a minute ago
    if (secsUntil > LEAD_MINUTES * 60) continue // too far away

    const key = notifKey(malId, item.episode)
    if (sent[key]) continue // already notified

    fireNotification(item, secsUntil)
    sent[key] = item.airingAt
    changed = true
  }

  if (changed) saveSent(sent)
}

function fireNotification(item: AiringSchedule, secsUntil: number) {
  const title = item.media.title.english || item.media.title.romaji
  const when = secsUntil <= 0
    ? 'airing now'
    : secsUntil < 60
      ? 'airing now'
      : `airing in ${Math.round(secsUntil / 60)}m`

  try {
    const n = new Notification(`${title} — Episode ${item.episode}`, {
      body: `${when[0].toUpperCase()}${when.slice(1)}. Tap to open.`,
      // Small inline SVG favicon so the OS has an icon to render
      icon: item.media.coverImage.large ?? undefined,
      tag: `kurodo-${item.media.id}-${item.episode}`,
      requireInteraction: false,
      silent: false,
    })
    n.onclick = () => {
      try {
        window.focus()
        if (item.media.idMal) {
          window.location.href = `/anime/${item.media.idMal}`
        }
      } catch { /* noop */ }
      n.close()
    }
  } catch {
    // Some browsers throw if requireInteraction etc. unsupported — ignore
  }
}

// ───────── Lifecycle ─────────
let intervalHandle: number | null = null
let visListenerAdded = false

/** Start the in-tab scheduler. Safe to call multiple times. */
export function startNotificationScheduler(): void {
  if (intervalHandle != null) return
  // First tick immediately so we don't miss anything that just aired
  void checkOnce()
  intervalHandle = window.setInterval(() => { void checkOnce() }, TICK_MS)

  // Also re-check when the tab becomes visible again (it may have slept).
  // Guard prevents double-registration under React 18 Strict Mode double-mount.
  if (!visListenerAdded) {
    document.addEventListener('visibilitychange', onVis)
    visListenerAdded = true
  }
}

export function stopNotificationScheduler(): void {
  if (intervalHandle != null) {
    window.clearInterval(intervalHandle)
    intervalHandle = null
  }
  if (visListenerAdded) {
    document.removeEventListener('visibilitychange', onVis)
    visListenerAdded = false
  }
}

function onVis() {
  if (document.visibilityState === 'visible') {
    void checkOnce()
  }
}

/** Send a test notification — used by the Settings "Test" button. */
export function sendTestNotification(): boolean {
  if (getPermission() !== 'granted') return false
  try {
    new Notification('Kurōdo — test notification', {
      body: 'Notifications are working. You\'ll be alerted when your watchlist shows air.',
      tag: 'kurodo-test',
    })
    return true
  } catch {
    return false
  }
}
