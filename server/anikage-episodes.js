// Anikage-style enriched episode API
// Merges TVDB v4 (REAL per-episode screenshots — same source anikage.cc
// uses) + AniZip (metadata) + TMDB (stills fallback) + Jikan (filler)
// Returns: [{ number, title, description, image, airDate, runtime, isFiller, rating }]
//
// PERF: TVDB + AniZip + Jikan run in parallel (Phase 1). TMDB runs in
// Phase 2 using the AniZip themoviedb_id from Phase 1. TVDB does its own
// internal AniZip call for the series id — this is intentional because
// making TVDB wait for the shared AniZip would add ~3s to cold load.
import axios from 'axios'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { getTvdbEpisodes } from './tvdb-episodes.js'
// Shared AniZip mapping layer (mem + disk + single-flight). TVDB's internal
// series-id resolution now reads from the SAME store, so a cold request no
// longer fires two identical ani.zip round-trips in parallel.
import { getAnizipMapping } from './anizip-cache.js'
import { isMalDown, noteMalDown } from './lib/mal-outage.js'

const cache = new Map()
const TTL = 60 * 60 * 1000; // 1 hour
// Short negative TTL for empty results: the client fires this request even
// for invalid MAL ids, so a nonexistent id shouldn't re-run the full
// multi-source fetch (TVDB login + AniZip + TMDB) on every visit. 3 min is
// short enough that a genuinely flaky upstream can't lock an anime to 0
// episodes for long.
const NEGATIVE_TTL = 3 * 60 * 1000;

function ok(res, data) {
  res.json({ ok: true, data });
}

// ── Disk cache for the Jikan filler/recap flags ──────────────────────────
// These flags are static MAL metadata, but they were re-fetched (up to 3
// sequential Jikan pages, capped at 1.2s) on EVERY cold episode request —
// after the TVDB + AniZip disk tiers landed, this stage became the only
// remaining cost of an episode list (~1.2s for every anime, every launch).
// Only COMPLETE result sets are persisted: a loop that broke early on a
// failure must not freeze "no filler badges" for 30 days.
const FLAG_DIR = process.env.KURODO_TVDB_CACHE_DIR || path.join(os.tmpdir(), 'kurodo-tvdb')
const FLAG_TTL = 30 * 24 * 60 * 60 * 1000

function flagPath(malId) {
  return path.join(FLAG_DIR, 'flags-' + crypto.createHash('sha1').update(`f:${malId}`).digest('hex') + '.json')
}

function readFlagDisk(malId) {
  try {
    const raw = JSON.parse(fs.readFileSync(flagPath(malId), 'utf-8'))
    if (!raw || !raw.flags || Date.now() - raw.at > FLAG_TTL) return null
    return raw.flags
  } catch { return null }
}

function writeFlagDisk(malId, flags) {
  try {
    fs.mkdirSync(FLAG_DIR, { recursive: true })
    fs.writeFileSync(flagPath(malId), JSON.stringify({ at: Date.now(), flags }))
  } catch { /* disk full / locked — the in-memory path still works */ }
}

function fail(res, err) {
  res.status(500).json({ ok: false, error: err?.message || 'unknown' });
}

export async function register(app) {
  app.get('/api/anikage-episodes/:malId', async (req, res) => {
    try {
      const malId = Number(req.params.malId);
      if (!malId || isNaN(malId)) return res.status(400).json({ ok: false, error: 'Invalid MAL id' });

      // Check cache (positive TTL 1h, negative/empty TTL 3min)
      const cached = cache.get(malId);
      const ttl = cached?.negative ? NEGATIVE_TTL : TTL;
      if (cached && Date.now() - cached.at < ttl) return ok(res, cached.data);

      // Per-stage timing: this endpoint is the cold-load cost of every
      // episode list, so keep the breakdown visible in the server log
      // (ELECTRON_TIMING-style) instead of guessing which upstream is slow.
      const tStart = Date.now()
      const tPhase1 = []
      const mark = (name) => { tPhase1.push(`${name} ${Date.now() - tStart}ms`) }

      // ── Phase 1: TVDB + AniZip + Jikan in PARALLEL (cold ~max(6s), not 9s) ──
      const [tvdbSettled, anizipSettled, jikanSettled] = await Promise.allSettled([
        // TVDB v4 real episode screenshots — Tier 1 (anikage.cc source).
        // Does its own internal AniZip call for the series id so it doesn't
        // wait for the shared AniZip fetch. One request returns all artwork.
        (async () => {
          const map = await getTvdbEpisodes(malId);
          mark('tvdb')
          if (map) console.log(`[anikage-episodes] TVDB artworks for MAL ${malId}: ${map.size} episodes`);
          return map;
        })(),

        // AniZip episodes (metadata + fallback images). Also supplies
        // the themoviedb_id for Phase 2's TMDB fetch. Via the shared cache:
        // single-flight dedupes against TVDB's internal series-id lookup and
        // the client mapping endpoint, and disk keeps it across restarts.
        (async () => {
          const m = (await getAnizipMapping({ malId })) || null;
          mark('anizip')
          return m;
        })(),

        // Jikan filler/recap flags — hard-capped at ~1.8s TOTAL. Filler
        // badges are a nice-to-have; a rate-limited Jikan must never hold up
        // the episode list. On timeout we return the partial flags and the
        // episodes render with isFiller=false (thumbnails/titles unaffected).
        //
        // fixes: the budget was 3.5s, which made Jikan the critical path for
        // long shows once TVDB got fast (One Piece: tvdb 1761ms, jikan
        // 2112ms → the whole request waited on filler badges). It also hit
        // api.jikan.moe directly, so it re-discovered a MAL outage that the
        // proxy had already recorded — isMalDown() now short-circuits it.
        (async () => {
          const diskFlags = readFlagDisk(malId);
          if (diskFlags) { mark('jikan-disk'); return diskFlags; }

          const flags = {};
          if (isMalDown()) { mark('jikan-skipped-mal-down'); return flags; }

          // Hard-bounded: a request started at the deadline used to run for
          // another `max(700, …)` on top, which is how a 1800ms budget
          // measured 2209ms and stayed the critical path on long shows.
          const deadline = Date.now() + 1200;
          let complete = false;
          for (let page = 1; page <= 3; page++) {
            const remain = deadline - Date.now();
            if (remain < 300) break;
            try {
              const { data } = await axios.get(`https://api.jikan.moe/v4/anime/${malId}/episodes`, {
                params: { page },
                timeout: remain,
              });
              const list = data?.data;
              if (!Array.isArray(list) || list.length === 0) { complete = true; break; }
              for (const e of list) {
                const num = Number(e.episode ?? e.mal_id);
                if (num > 0) flags[num] = { filler: !!e.filler, recap: !!e.recap };
              }
              if (!data?.pagination?.has_next_page) { complete = true; break; }
            } catch (e) {
              // 504 = MAL is unreachable for every Jikan endpoint — let the
              // proxy and this loop agree on that instead of each paying its
              // own doomed round trip.
              if (e?.response?.status === 504) noteMalDown();
              break;
            }
          }
          mark(complete ? 'jikan-complete' : 'jikan-partial')
          if (complete && Object.keys(flags).length > 0) writeFlagDisk(malId, flags)
          return flags;
        })(),
      ]);
      mark('phase1-done')

      const tvdbMap = tvdbSettled.status === 'fulfilled' ? tvdbSettled.value : null;
      const anizipData = anizipSettled.status === 'fulfilled' ? anizipSettled.value : null;
      const jikanFlags = jikanSettled.status === 'fulfilled' ? jikanSettled.value : {};
      if (anizipSettled.status === 'rejected') console.warn('[anikage-episodes] AniZip fetch failed:', anizipSettled.reason?.message);
      if (tvdbSettled.status === 'rejected') console.warn('[anikage-episodes] TVDB fetch failed:', tvdbSettled.reason?.message);

      // Shared episode list from AniZip (also used by the parse below).
      const rawEpisodes = Object.values(anizipData?.episodes || {})
        .filter(e => e.episode && e.episode >= 1 && e.episode % 1 === 0);

      // ── Phase 2: TMDB stills (needs AniZip's themoviedb_id from Phase 1) ──
      // SKIPPED when TVDB already covers every AniZip episode — TMDB is the
      // Tier-3 fallback, and its 4 sequential season calls (up to ~40s worst
      // case) add nothing when Tier-1 already has a real screenshot for each
      // episode. This keeps cold loads bounded by Phase 1 (~6s), not Phase 2.
      // Continuation shows (e.g. Bleach TYBW = MAL 41467 → TVDB series
      // 74796) live at HIGHER absolute numbers on TVDB (TYBW = 367-379)
      // than their local episode numbers (1-13). AniZip carries the
      // authoritative absoluteEpisodeNumber per episode, so the
      // completeness check (and the merge below) must use it — otherwise
      // every sequel show gets the PREQUEL's thumbnails.
      // Coverage instead of "all-or-nothing": requiring EVERY AniZip episode
      // in tvdbMap meant one missing episode (One Piece: 1178/1184) dropped
      // into TMDB's 4 season fetches for 700ms of extra cold load to fill a
      // handful of gaps. Above 90% the remaining holes are episodes TVDB
      // simply doesn't list yet (unaired/specials) — the same ones TMDB
      // lacks, and AniZip's own image still covers them.
      const tvdbCovered = (tvdbMap && rawEpisodes.length > 0)
        ? rawEpisodes.reduce(
            (n, e) => n + (tvdbMap.has(Number(e.absoluteEpisodeNumber ?? e.episode)) ? 1 : 0),
            0,
          )
        : 0;
      const tvdbComplete = rawEpisodes.length > 0 && tvdbCovered / rawEpisodes.length >= 0.9;
      const tmdbSeriesId = tvdbComplete
        ? null
        : (anizipData?.mappings?.themoviedb_id || null);
      const tmdbKey = process.env.TMDB_API_KEY || process.env.VITE_TMDB_API_KEY || '';
      let tmdbEps = {};
      if (!tmdbSeriesId) mark('tmdb-skipped')
      if (tmdbKey && tmdbSeriesId) {
        // Phase 2 was SEQUENTIAL — worst case 4 × 10s timeout = ~40s holding
        // up the episode list. Fire all four season fetches in parallel
        // instead: each response is tagged with its season number, so the
        // absolute numbering (running offset) is computed from the resolved
        // counts afterwards — order-independent. Worst case now ~10s, and
        // typical is ~1-3s on a warm TMDB edge.
        const settled = await Promise.allSettled(
          Array.from({ length: 4 }, (_, s) =>
            axios
              .get(`https://api.themoviedb.org/3/tv/${tmdbSeriesId}/season/${s + 1}`, {
                params: { api_key: tmdbKey },
                timeout: 10000,
              })
              .then((r) => ({ season: s + 1, data: r.data })),
          ),
        );
        const seasons = settled
          .filter((s) => s.status === 'fulfilled')
          .map((s) => s.value)
          .filter((s) => Array.isArray(s.data?.episodes) && s.data.episodes.length > 0)
          .sort((a, b) => a.season - b.season);
        let running = 0;
        for (const { data } of seasons) {
          for (const e of data.episodes) {
            if (e?.still_path && e.episode_number) {
              tmdbEps[running + e.episode_number] = `https://image.tmdb.org/t/p/w1280${e.still_path}`;
            }
          }
          running += data.episodes.length;
        }
      }

      mark('phase2-tmdb-done')

      // Drop null/'' fields per episode instead of emitting them. A long show
      // carries ~120 bytes of `"titleJp":null,"description":null,...` per
      // episode — 140KB+ of pure noise on One Piece — and the renderer only
      // ever reads these with a falsy check, so an absent key behaves
      // identically to null.
      const compact = (o) => {
        const out = {};
        for (const [k, v] of Object.entries(o)) {
          if (v === null || v === undefined || v === '') continue;
          out[k] = v;
        }
        return out;
      };

      let episodes = [];
      try {
        episodes = rawEpisodes
          .map(e => compact({
            number: Number(e.episode),
            absoluteNumber: Number(e.absoluteEpisodeNumber) || null,
            title: e.title?.en || e.title?.['x-jat'] || null,
            titleJp: e.title?.ja || null,
            description: e.overview || null,
            image: e.image || null,
            airDate: e.airDate || e.airDateUtc || null,
            runtime: e.runtime || null,
            isFiller: null,
            rating: null,
            seasonNumber: e.seasonNumber || null,
          }))
          .sort((a, b) => a.number - b.number);
      } catch (e) {
        console.warn('[anikage-episodes] AniZip parse failed:', e.message);
      }

      // 4. Merge — TVDB (Tier 1) wins, then AniZip, then TMDB; apply flags.
      //    Look TVDB up by ABSOLUTE episode number when AniZip provides it
      //    (continuation shows: TYBW ep 1 = TVDB abs 367), falling back to
      //    the local number for single-season shows where abs isn't set.
      episodes = episodes.map(ep => {
        const jikan = jikanFlags[ep.number] || {};
        const tvdb = tvdbMap?.get(ep.absoluteNumber ?? ep.number);
        return compact({
          ...ep,
          // TVDB artwork = real episode screenshot (anikage.cc source)
          image: tvdb?.image || ep.image || tmdbEps[ep.number] || null,
          // English title from AniZip wins (TVDB's default name is often
          // Japanese and it doesn't ship translations in the list response)
          title: ep.title || tvdb?.title,
          description: tvdb?.overview || ep.description,
          airDate: tvdb?.airDate || ep.airDate,
          runtime: tvdb?.runtime ?? ep.runtime,
          seasonNumber: tvdb?.seasonNumber ?? ep.seasonNumber,
          // Explicit booleans — the client reads these directly.
          isFiller: !!jikan.filler,
          isRecap: !!jikan.recap,
        });
      });

      // Also surface episodes that only TVDB knows about (AniZip gaps)
      if (tvdbMap && episodes.length === 0) {
        for (const [num, tvdb] of tvdbMap) {
          episodes.push(compact({
            number: num,
            title: tvdb.title,
            description: tvdb.overview,
            image: tvdb.image,
            airDate: tvdb.airDate,
            runtime: tvdb.runtime,
            isFiller: false,
            seasonNumber: tvdb.seasonNumber,
          }));
        }
        episodes.sort((a, b) => a.number - b.number);
      }

      if (process.env.KURODO_TIMING !== '0') {
        console.log(`[anikage-episodes] MAL ${malId}: ${episodes.length} eps · ${tPhase1.join(' · ')} · total ${Date.now() - tStart}ms${episodes.length > 0 && tvdbMap ? ` · tvdb ${tvdbMap.size}` : ''}`)
      }

      const result = { episodes, total: episodes.length, malId, source: 'tvdb+anizip+tmdb+jikan' };
      // Cache positive results for 1h. Empty results get a short 3-min
      // negative TTL instead — a transient upstream timeout (AniZip is
      // flaky) shouldn't lock the anime to 0 episodes for an hour, but an
      // invalid id also shouldn't re-run the whole fetch on every visit.
      cache.set(malId, { at: Date.now(), data: result, negative: episodes.length === 0 });

      // Prune cache
      if (cache.size > 100) {
        const n = Date.now();
        for (const [k, v] of cache) if (n - v.at > (v.negative ? NEGATIVE_TTL : TTL)) cache.delete(k);
      }

      return ok(res, result);
    } catch (e) {
      fail(res, e);
    }
  });
}
