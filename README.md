<div align="center">

<img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/dist/icon-256.png" alt="Kurōdo" width="110" />

# 蔵人 · Kurōdo

### **The cinematic anime desktop app Windows deserves.**

**Netflix-style UI · 15+ stream servers · real episode thumbnails · sub & dub · manga reader**

[![Latest Release](https://img.shields.io/github/v/release/Sylvester877/kurodo?style=flat-square&color=blueviolet&label=%E2%AC%A5%20download)](https://github.com/Sylvester877/kurodo/releases/latest)
[![Stars](https://img.shields.io/github/stars/Sylvester877/kurodo?style=flat-square&color=yellow&logo=github)](https://github.com/Sylvester877/kurodo/stargazers)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d6?style=flat-square&logo=windows)](https://github.com/Sylvester877/kurodo/releases/latest)
[![React](https://img.shields.io/badge/react-19-61dafb?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-5.7-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](./LICENSE)

**[⬇ Download the latest installer](https://github.com/Sylvester877/kurodo/releases/latest)** · auto-updates on every launch

<img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/ui-home-after.jpg" alt="Kurōdo home — cinematic hero, poster rails, glassmorphism UI" width="100%" />

</div>

---

## ⚡ Why Kurōdo

Most open-source anime players look like a settings panel. Kurōdo is built like a **product**:

| | |
|---|---|
| 🎬 **Cinematic UI** | Glassmorphism design system, blurred backdrops, magnetic poster cards, buttery Lenis scrolling, 6 theme presets |
| 🖼️ **Real episode thumbnails** | Every episode gets an actual TVDB screenshot (366/366 for *Bleach*), not a grey box with a number |
| 📺 **15+ stream servers** | Sub & dub, per-provider rate-limiting, automatic dead-server skipping, one-click switching mid-episode |
| ⌨️ **Keyboard-first** | `Space` `J/L` `N` `F` `T` `⌘K` — the whole app is drivable without a mouse |
| 🧠 **Smart playback** | Resume anywhere, intro/outro auto-skip, next-episode prefetch at 75% so ep N+1 starts instantly |
| 🔍 **Search that slaps** | Filter rail (season / format / status / score) + genres & sort dropdowns over a poster grid |
| 📚 **Manga reader** | MangaDex-backed, colour-edition support, reading stats, continue-reading rail |
| 🔄 **AniList sync** | Watchlist, progress, activity feed — two-way |

<div align="center">

| Watch | Search |
|---|---|
| <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/watch-jujutsu-kaisen.jpg" width="100%" /> | <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/search-redesign-results.jpg" width="100%" /> |
| **Servers** | **Schedule** |
| <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/review-watch-picker.jpg" width="100%" /> | <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/loop-after-schedule.jpg" width="100%" /> |

</div>

---

## 🚀 Quick start

> **Node.js ≥ 18** · Windows 10/11

```bash
git clone https://github.com/Sylvester877/kurodo.git
cd kurodo
npm install

# Web app — one Express server on http://localhost:5173
npm start

# Or the full Electron desktop app
npm run electron:dev
```

**Just want the app?** → **[Download the installer](https://github.com/Sylvester877/kurodo/releases/latest)** (`Kurodo-Setup-x.y.z.exe`), install, done. Updates arrive automatically via `electron-updater`.

### Build & publish

```bash
npm run electron:build:win        # → release/Kurodo-Setup-<version>.exe
GH_TOKEN=ghp_xxx npm run electron:build:win   # + publish a GitHub Release
```

---

## ⌨️ Keyboard shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| `Space` | Play / pause | `F` | Fullscreen |
| `J` / `L` | Seek ∓10s | `T` | Theater mode |
| `N` | Next episode | `M` | Mute |
| `⌘/Ctrl K` | Command palette | `/` | Focus search |

---

## 🧰 Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19 · TypeScript 5.7 · Tailwind v4 · Framer Motion · Lenis |
| State | Zustand 5 · TanStack Query 5 · React Virtual |
| Desktop | Electron 34 · electron-updater (NSIS) |
| Backend | Express · Node 24 |
| Scraping | Puppeteer CF-harvester · multi-provider router (megavid / anidap / gogoanime) |
| Video | HLS.js · WebTorrent · ffmpeg-static |

### Engineering highlights

- **Multi-provider stream router** — providers race in parallel; a 429 on one never kills playback, and cold source resolution lands in **~1.2s**
- **Server-side episode enrichment** — TVDB + AniZip + TMDB + Jikan fetched concurrently, capped so a rate-limited upstream can't stall a 500-episode list
- **Virtualized everything** — episode sidebars render ~15 rows out of 500+, Home rows lazy-mount near the viewport
- **Compositor-only animations** — reveals are pure opacity/transform (no per-frame blur raster), so scrolling stays at refresh rate

---

## 📁 Project layout

```
kurodo/
├── src/                  # React frontend
│   ├── api/              # AniList, Jikan, AniZip, TMDB, TVDB, anidap clients
│   ├── components/       # Player, cards, rails, search, settings…
│   ├── pages/            # Home, Watch, AnimeDetails, Search, Manga*, Profile…
│   ├── lib/ store/ hooks/
├── server/               # Express backend
│   ├── index.js          # API + proxies + image proxy
│   └── providers/        # megavid, anidap, gogoanime scrapers + router
├── electron/             # Main process (window, auto-update, IPC)
└── build/                # Icons + NSIS installer config
```

---

## 🗺️ Roadmap

- [ ] Multi-platform packaging (Linux AppImage, macOS dmg)
- [ ] Torrent streaming UI polish + subtitle auto-match
- [ ] Watch parties (synced playback + chat)
- [ ] MAL tracker support alongside AniList

---

## ⚠️ Disclaimer

Kurōdo is a **personal/educational project** and hosts **zero content** — streams are pulled from public third-party APIs at runtime. Please respect each source's terms of service and your local copyright laws. This project is not affiliated with AniList, MyAnimeList, TVDB, or any content provider.

## 📄 License

[MIT](./LICENSE) — fork it, remix it, ship it.

---

<div align="center">

**If Kurōdo made your watching better, drop a ⭐ — it genuinely helps.**

Made with ❤️ by [Sylvester877](https://github.com/Sylvester877)

</div>
