<div align="center">

<img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/public/icon-256.png" alt="Kurōdo logo" width="118" />

# 蔵人 · Kurōdo

### A cinematic anime & manga desktop experience.

**Discover · Watch · Track · Read**

[![Latest Release](https://img.shields.io/github/v/release/Sylvester877/kurodo?style=for-the-badge&label=LATEST%20RELEASE&color=7c3aed)](https://github.com/Sylvester877/kurodo/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/Sylvester877/kurodo/ci.yml?style=for-the-badge&label=CI)](https://github.com/Sylvester877/kurodo/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/Sylvester877/kurodo?style=for-the-badge&logo=github&color=f59e0b)](https://github.com/Sylvester877/kurodo/stargazers)
[![License](https://img.shields.io/github/license/Sylvester877/kurodo?style=for-the-badge)](./LICENSE)

<br />

<a href="https://github.com/Sylvester877/kurodo/releases/latest"><strong>⬇ Download for Windows</strong></a>
&nbsp;&nbsp;•&nbsp;&nbsp;
<a href="https://github.com/Sylvester877/kurodo/discussions"><strong>💬 Join the discussions</strong></a>
&nbsp;&nbsp;•&nbsp;&nbsp;
<a href="https://github.com/Sylvester877/kurodo/issues"><strong>🐛 Report a bug</strong></a>

<br /><br />

<img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/ui-home-after.jpg" alt="Kurōdo home screen" width="95%" />

<br /><br />

> **Built to feel like a real desktop product, not a developer demo.**

</div>

---

## ✦ What is Kurōdo?

Kurōdo is an open-source anime and manga desktop app focused on a polished, fast, keyboard-friendly experience.

Instead of treating discovery, playback, tracking, and reading as separate tools, Kurōdo brings them together behind one cinematic interface.

```text
Open Kurōdo  →  find something  →  press play
```

### Built for

**Viewers** who want a clean, focused interface.

**Power users** who want keyboard controls, fast navigation, and responsive large episode lists.

**Contributors** who want a real-world React + Electron project with UI, data, desktop, and performance work.

---

## 🎬 See it in action

<div align="center">

| **Home** | **Watch** |
|:---:|:---:|
| <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/ui-home-after.jpg" alt="Kurōdo home" width="100%" /> | <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/watch-playing.jpg" alt="Kurōdo player" width="100%" /> |

| **Search** | **Episode picker** |
|:---:|:---:|
| <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/search-redesign-results.jpg" alt="Kurōdo search results" width="100%" /> | <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/review-watch-picker.jpg" alt="Kurōdo episode picker" width="100%" /> |

</div>

More screenshots live in [`/docs`](./docs).

---

## ✨ What makes Kurōdo different?

| | Feature | Why it matters |
|:---:|---|---|
| 🎨 | **Cinematic UI** | Glassmorphism, backdrop imagery, animated cards, smooth scrolling, and multiple themes. |
| 📺 | **Multi-provider playback** | Multiple third-party providers can be routed with fallback behaviour and sub/dub support. |
| 🖼️ | **Real episode imagery** | Episode lists can show actual screenshots instead of generic numbered placeholders. |
| ⚡ | **Fast large-library navigation** | Virtualised lists, lazy rendering, caching, and prefetching keep content-heavy screens responsive. |
| 🧠 | **Smart playback** | Resume progress, next-episode flow, and intro/outro skipping features. |
| 🔎 | **Discovery-first search** | Poster-focused results with sorting, genres, season, format, status, and score filters. |
| 📚 | **Manga reader** | MangaDex-backed reading with continue-reading support and reading stats. |
| 🔄 | **AniList sync** | Keep watchlist, progress, and activity connected with AniList. |
| ⌨️ | **Keyboard-first controls** | Playback and navigation can be driven without constantly reaching for the mouse. |
| 📦 | **Desktop + PWA** | Electron desktop packaging plus a PWA-oriented web build. |

---

## 📥 Download

### Windows

The latest packaged Windows installer is available from GitHub Releases.

<div align="center">

### [⬇ Download the latest Kurōdo release](https://github.com/Sylvester877/kurodo/releases/latest)

`Kurodo-Setup-x.y.z.exe`

</div>

**Current release:** `v0.3.37`  
This release includes player-control improvements, a wider watch layout for 16:10 displays, a redesigned episode list, and fullscreen/crop fixes.

Existing installs can receive updates through `electron-updater`.

See the [full changelog](./CHANGELOG.md) or [all releases](https://github.com/Sylvester877/kurodo/releases).

---

## 🚀 Run locally

### Requirements

- Node.js 18+
- npm
- Windows 10/11 for the Electron desktop build

### Clone and install

```bash
git clone https://github.com/Sylvester877/kurodo.git
cd kurodo
npm install
```

### Start the server

```bash
npm start
```

### Launch Electron

```bash
npm run electron:dev
```

### Validate the project

```bash
npm run typecheck
npm test
npm run build
```

Or run all three checks together:

```bash
npm run check
```

### Build the Windows installer

```bash
npm run electron:build:win
```

The packaged installer is written to `release/`.

---

## ⌨️ Keyboard controls

| Shortcut | Action | Shortcut | Action |
|---|---|---|---|
| `Space` | Play / pause | `F` | Fullscreen |
| `J` / `L` | Seek ±10 seconds | `T` | Theater mode |
| `N` | Next episode | `M` | Mute |
| `Ctrl K` | Command palette | `/` | Focus search |

---

## 🧩 Tech stack

<div align="center">

**Frontend**  
React 19 · TypeScript · Tailwind CSS · Framer Motion · Lenis

**State & data**  
Zustand · TanStack Query · React Virtual

**Desktop**  
Electron · electron-builder · electron-updater · NSIS

**Backend**  
Node.js · Express

**Media**  
HLS.js · WebTorrent · FFmpeg

</div>

---

## ⚙️ Engineering highlights

### Multi-provider routing

External provider requests can be resolved independently so one slow or unavailable source does not necessarily block unrelated playback paths.

### Large episode lists

Episode-heavy shows use virtualised rendering so the UI does not need to mount hundreds of rows at once.

### Cached metadata and images

The PWA build uses targeted runtime caching for metadata and media assets to make repeat visits faster while keeping navigation fresh.

### Desktop packaging

The project includes an Electron shell, Windows NSIS installer configuration, and automatic update support.

### Lightweight validation

Every push to `main` and pull request can run typechecking, tests, and a production build through GitHub Actions.

---

## 📁 Project structure

```text
kurodo/
├── src/
│   ├── api/              # External API clients
│   ├── components/       # Player, cards, rails, search, settings...
│   ├── pages/            # Home, Watch, Search, Manga, Profile...
│   ├── hooks/
│   ├── lib/
│   └── store/
│
├── server/
│   ├── index.js          # Express server
│   └── providers/        # Provider routing logic
│
├── electron/             # Electron main process + IPC
├── build/                # Icons + installer configuration
├── public/               # App assets + PWA assets
├── docs/                 # Screenshots and visual references
└── .github/              # CI, issue forms, PR template, community config
```

---

## 🗺️ Roadmap

### Near-term

- [ ] Linux AppImage packaging
- [ ] macOS `.dmg` packaging
- [ ] Torrent streaming UI polish
- [ ] Automatic subtitle matching
- [ ] Watch parties with synced playback and chat
- [ ] MyAnimeList tracking alongside AniList

### Help wanted

A few roadmap items are deliberately scoped so contributors can pick them up without understanding the entire codebase first:

- **[Accessibility pass](https://github.com/Sylvester877/kurodo/issues/2)** · keyboard focus and screen-reader labels
- **[Linux AppImage](https://github.com/Sylvester877/kurodo/issues/3)** · packaging and release workflow
- **[Internationalisation](https://github.com/Sylvester877/kurodo/issues/4)** · translation-ready UI layer

Have a different idea? Start a [feature discussion](https://github.com/Sylvester877/kurodo/discussions) or [open an issue](https://github.com/Sylvester877/kurodo/issues/new).

---

## 🤝 Contributing

Kurōdo is open source and welcomes improvements across code, UI, documentation, accessibility, testing, and packaging.

```text
Find an issue → Fork → Branch → Change → Check → Pull request
```

Before contributing, read **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

For visual changes, include screenshots or a short recording in your pull request. CI checks the type system, test suite, and production build.

### Project standards

- [Contributing guide](./CONTRIBUTING.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security policy](./SECURITY.md)
- [MIT License](./LICENSE)

---

## 💬 Community

Use the repository for more than code:

**[💡 Discussions](https://github.com/Sylvester877/kurodo/discussions)**  
Share ideas, ask questions, suggest UI improvements, and help shape future releases.

**[🐛 Issues](https://github.com/Sylvester877/kurodo/issues)**  
Report reproducible bugs or work on scoped tasks marked for contributors.

**[📦 Releases](https://github.com/Sylvester877/kurodo/releases)**  
Follow new builds and read release notes.

---

## ⭐ Support Kurōdo

A star is the simplest way to support an open-source project you want to see continue.

If Kurōdo is useful to you, **star the repository** so it is easier to keep bookmarked and share with other people who may enjoy the project.

<div align="center">

<a href="https://github.com/Sylvester877/kurodo/stargazers">
<img src="https://img.shields.io/github/stars/Sylvester877/kurodo?style=for-the-badge&logo=github&label=⭐%20STAR%20KURŌDO&color=f59e0b" alt="Star Kurōdo" />
</a>

<br /><br />

<a href="https://github.com/Sylvester877/kurodo/releases/latest"><strong>⬇ Try the latest release</strong></a>
&nbsp;&nbsp;•&nbsp;&nbsp;
<a href="https://github.com/Sylvester877/kurodo/discussions"><strong>💬 Join the community</strong></a>

</div>

---

## ⚠️ Disclaimer

Kurōdo is a personal/educational open-source project and does not host video or manga content itself. Playback and metadata may rely on third-party services requested at runtime.

Users are responsible for following the terms of those services and applicable laws in their region. Kurōdo is not affiliated with AniList, MyAnimeList, TVDB, or any third-party content provider.

---

## 📄 License

Kurōdo is released under the **MIT License**. See [LICENSE](./LICENSE).

---

<div align="center">

<img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/public/icon-256.png" alt="Kurōdo" width="58" />

### 蔵人 · Kurōdo

**Watch something good.**

Made with ❤️ by **[Sylvester877](https://github.com/Sylvester877)**

<a href="https://github.com/Sylvester877/kurodo">Repository</a>
&nbsp;·&nbsp;
<a href="https://github.com/Sylvester877/kurodo/releases">Releases</a>
&nbsp;·&nbsp;
<a href="https://github.com/Sylvester877/kurodo/issues">Issues</a>
&nbsp;·&nbsp;
<a href="https://github.com/Sylvester877/kurodo/discussions">Discussions</a>

</div>
