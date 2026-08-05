<div align="center">

<img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/dist/icon-256.png" alt="Kurōdo" width="120" />

# 蔵人 · Kurōdo

**A cinematic anime & manga streaming desktop app — fast, beautiful, keyboard-first.**

[![Version](https://img.shields.io/badge/version-0.3.19-blueviolet)](https://github.com/Sylvester877/kurodo/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d6)](https://github.com/Sylvester877/kurodo/releases)
[![Electron](https://img.shields.io/badge/electron-34%2B-9cf)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/react-19-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-5.7-3178c6)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

**Auto-updating Windows app · Netflix-style UI · Real per-episode thumbnails · 15+ stream providers**

</div>

---

## ✨ What makes Kurōdo special

- **Real episode thumbnails** — every episode gets an actual screenshot from TVDB (the same source anikage.cc uses), not a grey box or a number over a banner. Long shows like *Bleach* get all 366.
- **Fast by design** — Home rows lazy-mount as you scroll, streams race across 15+ providers, episode lists are virtualized for 500+ episode shows, and the first episode list paints in ~5s cold.
- **Cinematic UI** — glassmorphism design system, blurred backdrops, magnetic poster cards, Lenis buttery smooth scrolling, theme presets (pink, violet, crimson, emerald, amber…).
- **Keyboard-first** — Space play/pause, J/L seek, N next episode, F fullscreen, T theater mode, ⌘K command palette.

---

## 🎬 Streaming

- **15+ provider servers** — yuki, gojo, koto, kami, nuri, neko, beep, uwu, vee, and more, with sub & dub tracks
- **Per-provider rate limiting & dead-provider skipping** — one 429 can't take down every server
- **Intro / outro auto-skip** — AniSkip community timestamps, Netflix-style skip button
- **Resume watching** — per-episode progress saved across sessions, continue-watching rails
- **Next-episode prefetching** — streams are decrypted in the background at 75% progress so the next episode starts instantly
- **Torrent streaming** — built-in WebTorrent with subtitle extraction + Wyzie subs

## 📚 Manga & Browse

- **Manga reader** — Mangadex-backed, with reading stats, chapter search, and a continue-reading rail
- **Search with deep filters** — format, status, genres, score, year (races Jikan vs AniList so results appear in seconds)
- **Watchlist & activity** — syncs with AniList (auto-mark watched, share activity)
- **Schedule & seasonal** — upcoming episode countdowns, seasonal lineups
- **Filler flags** — FILLER / RECAP badges on Naruto, Bleach, One Piece
- **Comments & social hub** — discuss episodes in-app
- **Top 100 & genre explorer** — ranked lists and curated genre tiles

## 🔗 Integrations

| Service | Used for |
|---|---|
| **TVDB** (v4 API) | Real per-episode screenshots — the anikage.cc source |
| **AniZip** | Episode metadata, titles, runtimes, ID mappings |
| **TMDB** | Title logos & backdrop art for the hero |
| **AniList** | Feeds, metadata, watchlist sync, activity |
| **Jikan** (MAL) | Scores, ranks, filler flags |
| **AniSkip** | Intro/outro timestamps |

---

## 🚀 Getting started

### Prerequisites
- **Node.js ≥ 18** · **npm ≥ 9**

### Run in development
```bash
git clone https://github.com/Sylvester877/kurodo.git
cd kurodo
npm install

# Web app (Vite + Express backend on :5173)
npm run dev

# Or the Electron desktop app
npm run electron:dev
```

### Build the installer
```bash
npm run electron:build:win   # → release/Kurodo-Setup-0.3.19.exe
```

### Publish a release (enables auto-update)
```bash
export GH_TOKEN=ghp_xxxxxxxxxxxx   # classic token with `repo` scope
npm run electron:build:win         # builds + publishes to GitHub Releases
```
Users with an older version get the update automatically on startup via `electron-updater`.

---

## 🧰 Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · TypeScript 5.7 · Tailwind CSS v4 · Framer Motion |
| State | Zustand 5 · TanStack React Query 5 · React Virtual 3 |
| Desktop | Electron 34 · electron-updater 6 (NSIS installer) |
| Backend | Express 4 · Node 24 |
| Scraping | Puppeteer + Electron CF-harvester, axios, Cloudflare bypass |
| Video | HLS.js · WebTorrent · ffmpeg-static |

---

## 🎯 Performance notes

- **Lazy-mounted Home** — below-fold rows only mount + fetch near the viewport (AniList is paced at 400ms/request, so bursting 9 queries used to cost ~3.5s before the hero painted)
- **Parallel episode enrichment** — TVDB / AniZip / TMDB / Jikan fetched concurrently server-side; the Jikan filler loop is capped at 3.5s so a rate-limited upstream can't stall the list
- **Virtualized episode sidebars** — 500+ episode shows render only ~15 rows
- **Route-level code splitting + hover preloaders** — pages and data are warm before you click
- **Aggressive caching** — persisted React Query snapshots, 24h image cache, server-side episode cache
- **Progressive image loading** — blurred placeholder → crisp full-res crossfade

---

## ⌨️ Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `J` / `L` | Seek −10s / +10s |
| `N` | Next episode |
| `F` | Fullscreen |
| `T` | Theater mode |
| `Ctrl/⌘ + K` | Command palette |
| `M` | Mute |

---

## 📁 Project layout

```
kurodo/
├── src/                  # React frontend
│   ├── api/              # AniList, Jikan, AniZip, TMDB, TVDB, anidap clients
│   ├── components/       # Player, cards, rails, settings, profile, social…
│   ├── pages/            # Home, Watch, AnimeDetails, Search, Manga*, Profile…
│   ├── lib/              # query client, prefetch, utils, adapters
│   ├── store/            # Zustand stores (auth, settings, watchlist)
│   └── hooks/
├── server/               # Express backend
│   ├── index.js          # API + proxies + image proxy
│   ├── anikage-episodes.js  # TVDB/AniZip/TMDB/Jikan episode enrichment
│   ├── tvdb-episodes.js  # TVDB v4 client (real episode screenshots)
│   └── providers/        # anidap, gogoanime, consumet scrapers
├── electron/             # Main process (window, auto-update, IPC)
├── build/                # Icons + NSIS installer config
└── scripts/              # Tests & utilities
```

---

## ⚠️ Disclaimer

Kurōdo is a **personal/educational project**. It does not host any content — streams are pulled from public third-party APIs. Please respect each source's terms of service and your local copyright laws.

---

<div align="center">
Made with ❤️ by <a href="https://github.com/Sylvester877">Sylvester877</a>
</div>
