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
import { getTvdbEpisodes } from './tvdb-episodes.js'

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

      // ── Phase 1: TVDB + AniZip + Jikan in PARALLEL (cold ~max(6s), not 9s) ──
      const [tvdbSettled, anizipSettled, jikanSettled] = await Promise.allSettled([
        // TVDB v4 real episode screenshots — Tier 1 (anikage.cc source).
        // Does its own internal AniZip call for the series id so it doesn't
        // wait for the shared AniZip fetch. One request returns all artwork.
        (async () => {
          const map = await getTvdbEpisodes(malId);
          if (map) console.log(`[anikage-episodes] TVDB artworks for MAL ${malId}: ${map.size} episodes`);
          return map;
        })(),

        // AniZip episodes (metadata + fallback images). Also supplies
        // the themoviedb_id for Phase 2's TMDB fetch.
        (async () => {
          const { data } = await axios.get(`https://api.ani.zip/mappings?mal_id=${malId}`, {
            timeout: 12000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          return data;
        })(),

        // Jikan filler/recap flags — hard-capped at ~3.5s TOTAL. Filler
        // badges are a nice-to-have; a rate-limited Jikan (its pages are
        // sequential, so the old 8s×3 worst case was ~24s) must never hold
        // up the episode list. On timeout we return the partial flags and
        // episodes render with filler=false (thumbnails/titles unaffected).
        (async () => {
          const flags = {};
          const deadline = Date.now() + 3500;
          for (let page = 1; page <= 3; page++) {
            if (Date.now() > deadline) break;
            try {
              const { data } = await axios.get(`https://api.jikan.moe/v4/anime/${malId}/episodes`, {
                params: { page },
                timeout: Math.max(1500, Math.min(4000, deadline - Date.now())),
              });
              const list = data?.data;
              if (!Array.isArray(list) || list.length === 0) break;
              for (const e of list) {
                const num = Number(e.episode ?? e.mal_id);
                if (num > 0) flags[num] = { filler: !!e.filler, recap: !!e.recap };
              }
              if (!data?.pagination?.has_next_page) break;
            } catch { break; /* Jikan down/limited — proceed without flags */ }
          }
          return flags;
        })(),
      ]);

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
      const tvdbComplete = !!tvdbMap && tvdbMap.size > 0 &&
        rawEpisodes.length > 0 &&
        rawEpisodes.every(e => tvdbMap.has(Number(e.absoluteEpisodeNumber ?? e.episode)));
      const tmdbSeriesId = tvdbComplete
        ? null
        : (anizipData?.mappings?.themoviedb_id || null);
      const tmdbKey = process.env.TMDB_API_KEY || process.env.VITE_TMDB_API_KEY || '';
      let tmdbEps = {};
      if (tmdbKey && tmdbSeriesId) {
        try {
          let running = 0;
          for (let s = 1; s <= 4; s++) {
            try {
              const { data } = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbSeriesId}/season/${s}`, {
                params: { api_key: tmdbKey },
                timeout: 10000,
              });
              if (!Array.isArray(data?.episodes) || data.episodes.length === 0) break;
              for (const e of data.episodes) {
                if (e?.still_path && e.episode_number) {
                  tmdbEps[running + e.episode_number] = `https://image.tmdb.org/t/p/w1280${e.still_path}`;
                }
              }
              running += data.episodes.length;
            } catch { break; }
          }
        } catch { /* TMDB unavailable — non-critical */ }
      }

      let episodes = [];
      try {
        episodes = rawEpisodes
          .map(e => ({
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
        const tmdbImage = tmdbEps[ep.number];
        const tvdb = tvdbMap?.get(ep.absoluteNumber ?? ep.number);
        return {
          ...ep,
          // TVDB artwork = real episode screenshot (anikage.cc source)
          image: tvdb?.image || ep.image || tmdbImage || null,
          // English title from AniZip wins (TVDB's default name is often
          // Japanese and it doesn't ship translations in the list response)
          title: ep.title || tvdb?.title,
          description: tvdb?.overview || ep.description,
          airDate: tvdb?.airDate || ep.airDate,
          runtime: tvdb?.runtime ?? ep.runtime,
          seasonNumber: tvdb?.seasonNumber ?? ep.seasonNumber,
          isFiller: jikan.filler || false,
          isRecap: jikan.recap || false,
        };
      });

      // Also surface episodes that only TVDB knows about (AniZip gaps)
      if (tvdbMap && episodes.length === 0) {
        for (const [num, tvdb] of tvdbMap) {
          episodes.push({
            number: num,
            title: tvdb.title,
            titleJp: null,
            description: tvdb.overview,
            image: tvdb.image,
            airDate: tvdb.airDate,
            runtime: tvdb.runtime,
            isFiller: false,
            rating: null,
            seasonNumber: tvdb.seasonNumber,
          });
        }
        episodes.sort((a, b) => a.number - b.number);
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
