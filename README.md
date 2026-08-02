<p align="center">
  <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/dist/icon-256.png" alt="Kurodo" width="128" />
</p>

<h1 align="center">Kurōdo</h1>
<p align="center">
  <strong>Discover & stream anime — fast, beautiful, keyboard-first.</strong><br/>
  A premium anime streaming desktop app with multi-provider scraping, AniList sync, and a cinematic Netflix-style UI.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.3-blueviolet" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-34%2B-9cf" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61dafb" alt="React" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

## ✨ Features

### 🎬 Streaming
- **10+ Scraper Providers** — yuki, gojo, koto, kami, nuri, neko, beep, uwu, vee, and more
- **Sub & Dub Support** — toggle between audio tracks with automatic English track detection
- **Multi-source fallback** — if one provider fails, the next one auto-switches instantly
- **Per-provider rate limiting** — prevents 429 storms from taking down all servers
- **Intro/Outro auto-skip** — powered by AniSkip community timestamps (like Netflix's "Skip Intro")
- **Resume where you left off** — progress saved per episode across sessions

### 🎨 UI/UX
- **Cinematic blurred backdrops** — each anime's artwork becomes the page background
- **Lenis smooth scrolling** — buttery 60fps scroll with parallax effects
- **Magnetic cards** — posters tilt toward your cursor on hover
- **Spotlight glow** — cards illuminate as you mouse over them
- **Keyboard shortcuts** — Space to play/pause, J/L seek, N next episode, F fullscreen, T theater mode
- **Theater mode** — hides sidebar for a wider player experience
- **Staggered card animations** — Netflix-style progressive grid reveal
- **Glass-morphism design system** — consistent pill badges, glass cards, accent glows

### 🔗 Integrations
- **AniList Sync** — auto-mark episodes as watched, sync your entire list
- **AniSkip** — community-submitted intro/outro skip timestamps
- **AniZip** — episode metadata and thumbnails
- **TMDB** — high-quality title logos for the hero banner
- **AniList feeds** — Trending, Seasonal, Upcoming, Most Favorite on Home
- **Filler detection** — FILLER and MIXED CANON badges for Naruto/Bleach/One Piece

### 📦 Platform
- **Electron desktop app** — native Chromium window with frameless design
- **Auto-update via GitHub Releases** — checks for new versions on startup
- **Local update detection** — finds new releases on disk for instant updates
- **PWA support** — service worker with offline caching
- **Torrent streaming** — built-in WebTorrent client with subtitle extraction
- **Wyzie Subs** — external subtitle provider integration

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript 5.7, Tailwind CSS v4, Framer Motion |
| **State** | Zustand 5, TanStack React Query 5 |
| **Virtualization** | TanStack React Virtual 3 |
| **Desktop** | Electron 34+, electron-updater 6 |
| **Backend** | Express 4, Node.js |
| **Scraping** | Puppeteer (headless), axios, Cloudflare bypass |
| **Video** | HLS.js 1.5, WebTorrent, ffmpeg-static |
| **Build** | Vite 6, electron-builder 25 (NSIS installer) |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** ≥ 18
- **npm** ≥ 9

### Install & Run

```bash
# Clone the repo
git clone https://github.com/Sylvester877/kurodo.git
cd kurodo

# Install dependencies
npm install

# Start in development mode (Vite + Express server)
npm run dev

# Or start the Electron desktop app
npm run electron:dev
```

The app opens at **http://localhost:5173**.

### Build the Installer

```bash
# Build the Windows NSIS installer (.exe)
npm run electron:build:win

# Output: release/Kurodo-Setup-0.3.3.exe
```

To publish to GitHub Releases (for auto-update):
```bash
# Set your GitHub token
export GH_TOKEN=ghp_xxxxxxxxxxxx

# Build + publish
npm run electron:build:win
```

---

## 📁 Project Structure

```
kurodo/
├── src/                    # React frontend
│   ├── api/                # API clients (AniList, AniSkip, AniZip, TMDB, anidap)
│   ├── components/         # React components
│   │   ├── AnimeCard.tsx   # Card with magnetic tilt + spotlight
│   │   ├── VideoPlayer.tsx # HLS.js player with skip buttons
│   │   ├── Watch/          # Episode sidebar, keyboard shortcuts
│   │   └── ...
│   ├── pages/              # Route pages
│   │   ├── Home.tsx        # Hero + grids + seasonal
│   │   ├── Watch.tsx       # Player + episode list + servers
│   │   ├── AnimeDetails.tsx# Hero banner + metadata + episodes
│   │   ├── Search.tsx      # Search with filters
│   │   └── ...
│   ├── lib/                # Utilities, prefetch, query client
│   ├── store/              # Zustand stores (auth, settings, watchlist)
│   └── hooks/              # Custom hooks
├── server/                 # Express backend
│   ├── index.js            # Main server + proxy routes
│   ├── providers/          # Scraper providers (anidap, gogoanime, consumet)
│   ├── lib/
│   │   └── cf-harvester/   # Puppeteer + Electron stream extraction
│   └── data/               # SQLite databases (comments)
├── electron/               # Electron main process
│   ├── main.js             # Window management + auto-update + IPC
│   └── preload.cjs         # Context bridge
├── build/                  # Build assets (icons, NSIS script)
├── scripts/                # Test scripts
└── package.json
```

---

## 🔧 Architecture

```
┌─────────────────────────────────────────────────┐
│                 Electron Shell                   │
│  ┌───────────────────────────────────────────┐  │
│  │         Chromium Renderer (React)         │  │
│  │  localhost:5173 ← Vite dev / dist static │  │
│  └──────────────┬────────────────────────────┘  │
│                 │ /api/*  /img/*                 │
│  ┌──────────────▼────────────────────────────┐  │
│  │         Express Backend (:5173)           │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  Provider Router                    │  │  │
│  │  │  anidap → gogoanime → consumet      │  │  │
│  │  └──────────────┬──────────────────────┘  │  │
│  │  ┌──────────────▼──────────────────────┐  │  │
│  │  │  CF Harvester (Puppeteer/Electron)  │  │  │
│  │  │  Cloudflare bypass + stream decrypt │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Stream Resolution Flow
1. User clicks an anime → `/anime/:malId` resolves metadata from Jikan + AniList
2. "Watch Now" → `/watch/:malId?ep=1` loads the Watch page
3. Server resolves the anidap slug + fetches available providers
4. User selects a provider (or auto-selects) → scraper extracts the decrypted stream URL
5. HLS.js plays the `.m3u8` with hardware-accelerated decoding
6. AniSkip timestamps enable one-click intro/outro skipping

---

## 🎯 Performance

- **Episode sidebar virtualization** — 500+ episode shows (Naruto, One Piece) render only ~15 visible rows
- **Deferred non-critical queries** — filler data and recommendations load after the critical path
- **Image proxy with 24h cache** — all CDN images go through `/img` proxy with fallback chains
- **Progressive image loading** — blurred placeholder → full resolution crossfade
- **Route-level code splitting** — VideoPlayer is `React.lazy` loaded
- **Zustand atomic selectors** — prevents cascading re-renders during playback ticks
- **`content-visibility: auto`** — off-screen grid items skip rendering

---

## 🐛 Known Issues

- **Jikan API 504s**: Upstream occasionally times out — gracefully returns empty fallbacks
- **Some anidap providers unavailable for specific titles**: Upstream availability varies by show
- **HLS manifest headers**: Some CDNs require specific Referer/Origin headers (handled via proxy)

---

## 📄 License

MIT — see [LICENSE](./LICENSE) for details.

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/Sylvester877">Sylvester877</a>
</p>
