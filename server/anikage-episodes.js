// Anikage-style enriched episode API
// Merges AniZip (TVDB images + metadata) + TMDB (stills) + Jikan (filler)
// Returns: [{ number, title, description, image, airDate, runtime, isFiller, rating }]
import axios from 'axios';

const cache = new Map();
const TTL = 60 * 60 * 1000; // 1 hour

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

      // Check cache
      const cached = cache.get(malId);
      if (cached && Date.now() - cached.at < TTL) return ok(res, cached.data);

      // 1. Fetch AniZip episodes (TVDB images + full metadata)
      let episodes = [];
      try {
        const { data } = await axios.get(`https://api.ani.zip/mappings?mal_id=${malId}`, {
          timeout: 12000,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const raw = Object.values(data?.episodes || {});
        episodes = raw
          .filter(e => e.episode && e.episode >= 1 && e.episode % 1 === 0)
          .map(e => ({
            number: Number(e.episode),
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
        console.warn('[anikage-episodes] AniZip fetch failed:', e.message);
      }

      // 2. Fetch TMDB stills (fill missing images)
      let tmdbEps = {};
      try {
        const tmdbKey = process.env.TMDB_API_KEY || process.env.VITE_TMDB_API_KEY || '';
        if (tmdbKey) {
          // Get TMDB ID from AniZip
          const tmdbIdRes = await axios.get(`https://api.ani.zip/mappings?mal_id=${malId}`, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          const tmdbId = tmdbIdRes.data?.mappings?.themoviedb_id;
          if (tmdbId) {
            let running = 0;
            for (let s = 1; s <= 4; s++) {
              try {
                const { data } = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${s}`, {
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
          }
        }
      } catch (e) {
        console.warn('[anikage-episodes] TMDB fetch failed:', e.message);
      }

      // 3. Fetch Jikan filler/recap flags
      let jikanFlags = {};
      try {
        for (let page = 1; page <= 3; page++) {
          const { data } = await axios.get(`https://api.jikan.moe/v4/anime/${malId}/episodes`, {
            params: { page },
            timeout: 8000,
          });
          const list = data?.data;
          if (!Array.isArray(list) || list.length === 0) break;
          for (const e of list) {
            const num = Number(e.episode ?? e.mal_id);
            if (num > 0) {
              jikanFlags[num] = { filler: !!e.filler, recap: !!e.recap };
            }
          }
          if (!data?.pagination?.has_next_page) break;
        }
      } catch (e) {
        console.warn('[anikage-episodes] Jikan fetch failed:', e.message);
      }

      // 4. Merge: fill missing images with TMDB, apply filler flags
      episodes = episodes.map(ep => {
        const jikan = jikanFlags[ep.number] || {};
        const tmdbImage = tmdbEps[ep.number];
        return {
          ...ep,
          image: ep.image || tmdbImage || null,
          isFiller: jikan.filler || false,
          isRecap: jikan.recap || false,
        };
      });

      const result = { episodes, total: episodes.length, malId };
      cache.set(malId, { at: Date.now(), data: result });
      
      // Prune cache
      if (cache.size > 100) {
        const n = Date.now();
        for (const [k, v] of cache) if (n - v.at > TTL) cache.delete(k);
      }

      return ok(res, result);
    } catch (e) {
      fail(res, e);
    }
  });
}
