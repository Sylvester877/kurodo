// Shared "MyAnimeList is currently unreachable" flag.
//
// A Jikan 504 means Jikan could not connect to MyAnimeList — an upstream state
// that affects EVERY Jikan endpoint, not one request. Several call sites used
// to discover this independently and each paid its own doomed round trip
// (server/index.js's proxy retry, anikage-episodes.js's filler-flag loop).
//
// Whichever caller sees a 504 records it here; every other caller can then
// skip Jikan entirely and go straight to the fallback it already has.
// Deliberately short: a real recovery must be picked up within ~45s.
const TTL_MS = 45_000
let downUntil = 0

export function noteMalDown() {
  downUntil = Date.now() + TTL_MS
}

export function isMalDown() {
  return Date.now() < downUntil
}

export function malDownMsLeft() {
  return Math.max(0, downUntil - Date.now())
}
