# Second provider family — research findings (Sep 2026)

Goal: add a second source family (hianime/aniwatch-class) for shows anidap
lacks. Result: **every candidate is currently unreachable headless**. This
doc records what was tested and what would change the verdict, so the next
attempt takes minutes, not hours.

## Candidates tested (all dead/gated for plain-HTTP, Sep 26 2026)

| Candidate | Status | Blocker |
|---|---|---|
| `@genga-movie/aniwatch` (npm scraper) | ❌ | pins `aniwatchtv.to` — TLS cert expired, domain dead |
| hianime mirrors (`hianimez.to/.cx/.app/.bz`, `hianime.nz`, `aniwatchtv.com.br`, `hianime.mom`, `animekai.to`) | ❌ | dead or tombstone page ("now Kaori") |
| Kaori (`kaorii.app` + `api.kaorii.app`) | ⚠️ partial | catalog API is LIVE and clean (search/anime/home, AniList+MAL keyed) but its player layer routes through MegaPlay embeds (410) or `anilink.cc` |
| Anilink (`anilink.cc`) | ❌ | `/api/internal/streams/*` gated by `stream-challenges` POST handshake (identity/protection stage) |
| Anify (`api.anify.tv`, `anify.eltik.net`) | ❌ | nginx 301 → nowhere (service moved/dead) |
| MegaPlay direct (`megaplay.buzz/stream/{mal,ani,s-2}/...`) | ❌ | MAL/AniList routes 410; even the working `s-2` route serves an error page for un-owned IDs; real playback behind eval-obfuscated `e1-player.min.js` |
| Anikoto (`anikotoapi.site` → `anikototv.to`) | ⚠️ | catalog + `/ajax/episode/list/<id>` OPEN (returns full episode HTML with `data-mal`, `data-timestamp`); but playback maps to the **nekostream mapper** → animepahe/Kiwik downloads → kwik.cx (Cloudflare challenge) |
| mapper.nekostream.site | ⚠️ works | `GET /api/mal/<malId>/<epNum>/<timestamp>` returns download/quality map (verified FMA:B 5114 ep1 sub+dub, One Piece 21) — but everything lands on kwik.cx |
| kwik.cx | ❌ | Cloudflare interstitial; needs the cf-harvester browser + likely JS solve |

## What DID work from this machine

- `anikotoapi.site` (Anikoto/MegaPlay catalog API): `recent-anime`, `series/{id}`
  (embed ids per episode/sub/dub).
- `anikototv.to` watch pages + `/ajax/episode/list/<id>` (episode metadata incl.
  per-ep `data-mal`, `data-timestamp`, `data-sub/dub` flags).
- `mapper.nekostream.site/api/mal/<malId>/<ep>/<ts>` → quality/download map.
- Kurodo's existing bloom-family CDN (`fetch.nexabloom.top`) with the megaplay
  referer — this remains the ONLY live "second family" for *subtitles*.

## Architecture implication

The second family doesn't need a new provider module so much as a **browser
door**: kwik/megacloud-class players are challenge-gated by design. Kurodo
already ships `cf-harvester` (Electron browser fetch seam). The candidate
implementation when the door exists:

1. `mapper.nekostream.site` for (malId, ep) → kwik file URLs (open JSON, 1h cache).
2. cf-harvester opens kwik file page, solves challenge, intercepts the
   `sources`/m3u8 request (kwik always exposes a plain `.m3u8` to a real browser).
3. Return in anidap shape `{ url, headers: { Referer: kwik origin }, tracks: [] }`.
   Note: animepahe/Kiwik streams are HARDSUB (no VTT tracks) — fine as a
   fallback for shows anidap lacks, not a subtitle upgrade.

## Revisit triggers

- Any hianime-family domain returns real search HTML again (check
  `hianimez.app`, `hianime.nz`) → `@genga-movie/aniwatch` with patched baseUrl
  becomes viable in ~20 lines.
- Kaori's `api.kaorii.app` grows episode/sources endpoints (watch
  `/api/homepage` shape) → cleanest JSON integration available.
- Anilink's challenge handshake gets solved publicly → it aggregates anivexa's
  5 servers behind AniList IDs.
- Kurodo's cf-harvester gains kwik-solve capability → nekostream mapper +
  kwik is the always-available path (covers hardsub fallback for any MAL id).
