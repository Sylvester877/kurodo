<div align="center">

<img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/public/icon-256.png" alt="Kurōdo logo" width="120" />

# 蔵人 · Kurōdo

### A cinematic anime experience built for the desktop.

**Discover · Watch · Track · Read**

[![Latest Release](https://img.shields.io/github/v/release/Sylvester877/kurodo?style=for-the-badge&label=LATEST%20RELEASE&color=7c3aed)](https://github.com/Sylvester877/kurodo/releases/latest)
[![Stars](https://img.shields.io/github/stars/Sylvester877/kurodo?style=for-the-badge&logo=github&color=f59e0b)](https://github.com/Sylvester877/kurodo/stargazers)
[![Forks](https://img.shields.io/github/forks/Sylvester877/kurodo?style=for-the-badge&logo=github)](https://github.com/Sylvester877/kurodo/network/members)
[![License](https://img.shields.io/github/license/Sylvester877/kurodo?style=for-the-badge)](./LICENSE)

<br />

<a href="https://github.com/Sylvester877/kurodo/releases/latest"><strong>⬇ Download for Windows</strong></a>
&nbsp;&nbsp;•&nbsp;&nbsp;
<a href="https://github.com/Sylvester877/kurodo/issues">Report a bug</a>
&nbsp;&nbsp;•&nbsp;&nbsp;
<a href="https://github.com/Sylvester877/kurodo/discussions">Discuss the project</a>

<br /><br />

<img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/ui-home-after.jpg" alt="Kurōdo home screen" width="94%" />

<br /><br />

> **Kurōdo is built to feel like a real streaming product, not a developer demo.**

</div>

---

## ✦ What is Kurōdo?

Kurōdo is an open-source anime desktop app focused on making the entire experience feel fast, polished and easy to navigate.

It combines a cinematic interface with anime discovery, episode playback, watch progress, AniList synchronisation and a manga reading experience in one place.

The project is designed around a simple idea:

**Open Kurōdo → find something → press play.**

---

## 🎬 The experience

<div align="center">

| **Home** | **Watch** |
|:---:|:---:|
| <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/ui-home-after.jpg" alt="Kurōdo home" width="100%" /> | <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/watch-playing.jpg" alt="Kurōdo player" width="100%" /> |

| **Search** | **Episode selection** |
|:---:|:---:|
| <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/search-redesign-results.jpg" alt="Kurōdo search" width="100%" /> | <img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/docs/review-watch-picker.jpg" alt="Kurōdo episode picker" width="100%" /> |

</div>

---

## ✨ Why Kurōdo?

| | Feature | Details |
|:---:|---|---|
| 🎨 | **Cinematic interface** | Glassmorphism, backdrop imagery, animated cards, smooth scrolling and multiple themes. |
| 📺 | **Flexible playback** | Multiple streaming providers with fallback behaviour and sub/dub support. |
| 🖼️ | **Real episode imagery** | Episodes can use actual screenshots instead of generic numbered placeholders. |
| ⚡ | **Fast navigation** | Virtualised lists, lazy rendering and prefetching keep large libraries responsive. |
| 🧠 | **Smart playback** | Resume progress, next-episode flow and intro/outro skipping features. |
| 🔎 | **Powerful discovery** | Search, sorting, genres and filters in a poster-focused interface. |
| 📚 | **Manga reader** | MangaDex-backed reading with continue-reading support and reading stats. |
| 🔄 | **AniList sync** | Watchlist, progress and activity can stay connected with AniList. |
| ⌨️ | **Keyboard-first** | Common playback and navigation actions can be controlled without a mouse. |

---

## 🖥️ Download

### Windows

The latest Windows installer is available from GitHub Releases.

<div align="center">

### [⬇ Download Kurōdo for Windows](https://github.com/Sylvester877/kurodo/releases/latest)

**Installer:** `Kurodo-Setup-x.y.z.exe`

</div>

The latest published release is **v0.3.37**. It includes player-control improvements, a wider watch layout for 16:10 displays, an updated episode list and fullscreen/crop fixes.

Existing installations can receive updates through `electron-updater`.

---

## 🚀 Run it locally

### Requirements

- Node.js 18+
- Windows 10/11 for the Electron desktop build
- npm

### 1. Clone

```bash
git clone https://github.com/Sylvester877/kurodo.git
cd kurodo
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the server

```bash
npm start
```

### 4. Launch the Electron app

```bash
npm run electron:dev
```

### Build a Windows installer

```bash
npm run electron:build:win
```

The packaged installer is written to the `release/` directory.

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

## ⚙️ Under the hood

Kurōdo is not only a visual project. A large part of the work is in keeping the app responsive while dealing with large anime libraries and multiple external services.

### Multi-provider playback

Provider requests can be resolved in parallel so a slow or unavailable source does not necessarily block the rest of the playback flow.

### Large episode lists

Episode-heavy shows use virtualised rendering so the UI does not need to mount hundreds of rows at once.

### Concurrent metadata enrichment

External metadata sources can be queried together and handled without making a large episode list wait on a single upstream response.

### Desktop packaging

The project includes an Electron desktop shell, Windows installer configuration and automatic update support.

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
│   └── providers/        # Streaming provider logic
│
├── electron/             # Electron main process + IPC
├── build/                # Icons + installer configuration
├── public/               # App assets
└── docs/                 # Screenshots used in the README
```

---

## 🗺️ Roadmap

### In progress / planned

- [ ] Linux AppImage packaging
- [ ] macOS `.dmg` packaging
- [ ] Torrent streaming UI polish
- [ ] Automatic subtitle matching
- [ ] Watch parties with synced playback and chat
- [ ] MyAnimeList tracking alongside AniList

Have an idea that would make Kurōdo better?

**[→ Open a feature request](https://github.com/Sylvester877/kurodo/issues/new)**

---

## 🤝 Contributing

Kurōdo is open source and improvements are welcome.

```text
Fork → Create a branch → Make your changes → Open a pull request
```

Before contributing, check **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the project guidelines.

For bugs, please include enough information to reproduce the issue, including your operating system, Kurōdo version and relevant logs or screenshots.

---

## ⭐ Support the project

Kurōdo is an independent project. The simplest way to help is to **star the repository**.

A star makes the project easier to discover and shows that people are interested in seeing it continue.

<div align="center">

<a href="https://github.com/Sylvester877/kurodo/stargazers">
<img src="https://img.shields.io/github/stars/Sylvester877/kurodo?style=for-the-badge&logo=github&label=⭐%20STAR%20KURŌDO&color=f59e0b" alt="Star Kurōdo" />
</a>

</div>

---

## ⚠️ Disclaimer

Kurōdo is a personal/educational open-source project and does not host video or manga content itself. Playback and metadata may rely on third-party services requested at runtime.

Users are responsible for following the terms of those services and applicable laws in their region. Kurōdo is not affiliated with AniList, MyAnimeList, TVDB or any third-party content provider.

---

## 📄 License

Kurōdo is released under the **MIT License**. See [LICENSE](./LICENSE).

---

<div align="center">

<img src="https://raw.githubusercontent.com/Sylvester877/kurodo/main/public/icon-256.png" alt="Kurōdo" width="64" />

### 蔵人 · Kurōdo

**Watch something good.**

Made with ❤️ by **[Sylvester877](https://github.com/Sylvester877)**

<br />

<a href="https://github.com/Sylvester877/kurodo">Repository</a>
&nbsp;·&nbsp;
<a href="https://github.com/Sylvester877/kurodo/releases">Releases</a>
&nbsp;·&nbsp;
<a href="https://github.com/Sylvester877/kurodo/issues">Issues</a>

</div>
