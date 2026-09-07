<div align="center">

<img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/public/icon-256.png" alt="Kurōdo" width="120" />

# 蔵人 · Kurōdo

### A cinematic anime experience for Windows.

**Netflix-style UI · 15+ stream providers · real episode thumbnails · sub & dub · manga reader**

[![Latest Release](https://img.shields.io/github/v/release/Sylvester877/kurodo?style=for-the-badge&color=7c3aed&label=DOWNLOAD)](https://github.com/Sylvester877/kurodo/releases/latest)
[![Stars](https://img.shields.io/github/stars/Sylvester877/kurodo?style=for-the-badge&logo=github&color=f59e0b)](https://github.com/Sylvester877/kurodo/stargazers)
[![Forks](https://img.shields.io/github/forks/Sylvester877/kurodo?style=for-the-badge&logo=github)](https://github.com/Sylvester877/kurodo/network/members)
[![License](https://img.shields.io/github/license/Sylvester877/kurodo?style=for-the-badge)](./LICENSE)

<br />

**[⬇ Download Kurōdo](https://github.com/Sylvester877/kurodo/releases/latest)** · **[⭐ Star the project](https://github.com/Sylvester877/kurodo)** · **[🐛 Report a bug](https://github.com/Sylvester877/kurodo/issues/new)**

<br />

<img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/ui-home-after.jpg" alt="Kurōdo home screen" width="95%" />

</div>

---

## ✦ What is Kurōdo?

Kurōdo is an open-source anime desktop app designed to feel like a polished streaming product rather than a basic video player.

The goal is simple: **open the app, find something to watch, and get straight into the episode.**

## ✨ Highlights

| Feature | What it does |
| --- | --- |
| 🎬 **Cinematic UI** | Glassmorphism, blurred backdrops, animated poster cards and smooth scrolling |
| 🖼️ **Episode thumbnails** | Real episode screenshots instead of generic numbered placeholders |
| 📺 **15+ stream providers** | Sub & dub support with provider fallback and mid-episode switching |
| ⚡ **Fast playback** | Smart source resolution, resume progress and next-episode prefetching |
| 🧠 **Smart controls** | Intro/outro skipping, watch progress and keyboard-first navigation |
| 🔎 **Powerful search** | Poster grid with filters for season, format, status, score and genres |
| 📚 **Manga reader** | MangaDex-powered reading with colour editions and continue-reading support |
| 🔄 **AniList sync** | Two-way watchlist, progress and activity synchronisation |
| 🎨 **6 themes** | Multiple visual presets to customise the experience |

---

## 🎥 See Kurōdo in action

<div align="center">

| Home | Watch |
| --- | --- |
| <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/ui-home-after.jpg" width="100%" /> | <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/watch-playing.jpg" width="100%" /> |
| **Search** | **Server picker** |
| <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/search-redesign-results.jpg" width="100%" /> | <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/review-watch-picker.jpg" width="100%" /> |

</div>

---

## 🚀 Get started

**Requirements:** Node.js 18+ · Windows 10/11

```bash
git clone https://github.com/Sylvester877/kurodo.git
cd kurodo
npm install
npm start
```

For the full Electron desktop app:

```bash
npm run electron:dev
```

### 📦 Want the ready-to-use app?

You don't need to build anything.

**[Download the latest Windows installer →](https://github.com/Sylvester877/kurodo/releases/latest)**

Kurōdo uses `electron-updater` so installed versions can receive updates automatically.

---

## ⌨️ Keyboard shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `Space` | Play / pause | `F` | Fullscreen |
| `J` / `L` | Seek ±10s | `T` | Theater mode |
| `N` | Next episode | `M` | Mute |
| `Ctrl K` | Command palette | `/` | Focus search |

---

## 🧰 Built with

**Frontend**  React 19 · TypeScript 5.7 · Tailwind v4 · Framer Motion · Lenis  
**State**  Zustand 5 · TanStack Query 5 · React Virtual  
**Desktop**  Electron 34 · electron-updater · NSIS  
**Backend**  Express · Node 24  
**Video**  HLS.js · WebTorrent · ffmpeg-static

### ⚙️ Engineering highlights

- **Multi-provider router:** providers race in parallel, allowing failed or rate-limited sources to be skipped.
- **Concurrent metadata enrichment:** TVDB, AniZip, TMDB and Jikan requests are coordinated to keep large episode lists responsive.
- **Virtualised lists:** large episode sidebars and content rails render only what is needed on screen.
- **Smooth rendering:** animations focus on compositor-friendly transforms and opacity for consistent scrolling.

---

## 📁 Project structure

```text
kurodo/
├── src/                  # React frontend
│   ├── api/              # API clients
│   ├── components/       # Player, cards, rails, search, settings...
│   ├── pages/            # Home, Watch, Search, Manga, Profile...
│   └── lib/ store/ hooks/
├── server/               # Express backend and provider router
├── electron/             # Electron main process and IPC
└── build/                # App icons and installer configuration
```

---

## 🗺️ Roadmap

- [ ] Linux AppImage packaging
- [ ] macOS `.dmg` packaging
- [ ] Torrent streaming UI polish
- [ ] Automatic subtitle matching
- [ ] Watch parties with synced playback
- [ ] MAL tracking alongside AniList

Have an idea? **[Open an issue →](https://github.com/Sylvester877/kurodo/issues/new)**

---

## 🤝 Contributing

Found a bug, have a feature idea, or want to improve the UI?

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Open a pull request

Small improvements are welcome. If you like the project, **a star is the easiest way to support it.** ⭐

---

## ⚠️ Disclaimer

Kurōdo is a personal/educational open-source project and hosts **zero video or manga content**. Streams and metadata are requested from third-party services at runtime. Please respect the terms of each service and applicable copyright laws. Kurōdo is not affiliated with AniList, MyAnimeList, TVDB, or any content provider.

## 📄 License

MIT License. See [LICENSE](./LICENSE).

<div align="center">

<br />

### ⭐ If you like Kurōdo, consider starring the repository

It helps more people discover the project and motivates continued development.

**Made with ❤️ by [Sylvester877](https://github.com/Sylvester877)**

</div>
