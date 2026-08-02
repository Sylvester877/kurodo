# 🎬 Anidap Extractor & Streaming Gateway

A high-performance extraction system and proxy gateway for Anidap media. This project provides a complete solution for mapping AniList metadata, bypassing anti-bot protections, decrypting private stream tokens, and serving HLS content across origins.

---

## 🚀 Core Features

- **Metadata Mapping**: Resolve AniList IDs directly to Anidap slugs and info.
- **Dynamic Type Detection**: Automatically identifies `Sub`, `Dub`, and `H-Subs`.
- **Crypto Engine**: Implements the proprietary AES-GCM and custom XOR key derivation.
- **Manifest Rewriter**: A proxy that dynamically injects CORS headers and rewrites `.m3u8` relative links to ensure seamless segment loading.
- **Golden Headers**: Pre-configured browser fingerprints to stay under the radar of bot detection.

---

## 📡 The Proxy & HLS Logic

Fetching the link is only half the battle. To make the stream work in a custom HLS player (like HLS.js or Video.js), you **must** use the `proxy_server.js`.

### Why the Proxy is Mandatory:
1.  **CORS Enforcement**: Media servers often block requests originating from different domains.
2.  **Referer Validation**: Anidap's media providers (like `koto` or `mochi`) reject requests that don't carry specific referer headers.
3.  **Manifest Link Rewriting**: Our proxy scans the `.m3u8` file and converts relative segment paths into absolute paths routed through the proxy, ensuring the entire stream loads without 403 errors.

---

## 🔗 API Reference

### 1. AniList to Slug Mapping
Anidap uses unique slugs (e.g., `one-piece-fznhz`) for its internal APIs.

- **Endpoint**: `GET https://anidap.se/info/{anilist_id}.data`
- **Example**: `https://anidap.se/info/21.data`
- **Output**: Returns a dehydrated JSON array containing the **Slug** and full **Metadata** (Synopsis, English/Native titles, Banner images).

### 2. Episode List & Thumbnails
- **Endpoint**: `GET https://anidap.se/api/anime/{slug}/episodes?refresh=false`
- **Example**: `https://anidap.se/api/anime/one-piece-fznhz/episodes?refresh=false`
- **Data Attributes**:
  - `number`: Episode number
  - `img`: High-quality episode thumbnail (TVDB source)
  - `titles`: Localized episode titles
  - `hasDub` / `hasSub`: Multi-audio availability flags

### 3. Server Selection
- **Endpoint**: `GET https://anidap.se/api/anime/servers?id={slug}&ep={number}`
- **Description**: Returns lists of sub, dub, and hsub providers for a specific episode.

### 4. Source Retrieval (Encrypted)
- **Endpoint**: `GET https://anidap.se/api/anime/sources?id={slug}&ep={number}&host={provider}&type={sub|dub|hsub}`
- **Response**: `{ success: true, data: "ENCRYPTED_STRING" }`

---

## 🔐 Security & Anti-Bot Protection

The Anidap API implements strict bot protection. Incomplete requests often receive a `403 Forbidden` response or the "YOUR GAY!" troll message.

| Header | Value | Importance |
| :--- | :--- | :--- |
| `User-Agent` | Recent Chrome/Windows agent (e.g. Chrome v146+) | **Critical** |
| `Referer` | `https://anidap.se/watch?id={slug}&ep={number}...` | **Required** |
| `sec-ch-ua` | `"Chromium";v="146", "Google Chrome";v="146"` | **Required** |
| `sec-fetch-site` | `same-origin` | Recommended |

---

## 🛠️ Developer Implementation

### 1. Library Usage (`extractor.js`)
```javascript
import { getProviders, getStream } from './extractor.js';

const animeId = "one-piece-fznhz";
const ep = 1156;

const providers = await getProviders(animeId, ep);
const stream = await getStream(animeId, ep, providers[0]);

console.log(stream.url); // Use with local proxy
```

### 2. Frontend Player (HLS.js)
```javascript
const video = document.getElementById('video');
const streamUrl = 'http://localhost:3000/proxy?url=' + encodeURIComponent(proxiedUrl);

if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
}
```

---

## 📊 Server Matrix (Provider Types)

| Provider | Sub | H-Subs | Dub | Best For |
| :--- | :---: | :---: | :---: | :--- |
| **koto / nuri** | ✅ | | ✅ | ⚡ Speed (vcdn) |
| **mochi / kiwi** | | ✅ | ✅ | 🎞️ High Quality |
| **kami / gogo** | ✅ | | ✅ | 🛡️ Reliability |
| **wave / shiro** | ✅ | ✅ | | 🌏 Region variety |

---

## 💡 Pro-Tips for Success

> [!TIP]
> **403 Forbidden Errors**: Usually caused by a missing referer. The `proxy_server.js` automatically attaches the correct `Referer` for Anidap media servers.

> [!IMPORTANT]
> **Token Expiry**: Decryption tokens are tied to a 1-minute window of `Date.now()`. If a stream fails after idle time, refresh the decryption token.

---

## 📂 Implementation Summary
- **[extractor.js](file:///d:/CodeVault/anidap/extractor.js)**: Core script to fetch and decrypt (Renamed from `final.js`).
- **[proxy_server.js](file:///d:/CodeVault/anidap/proxy_server.js)**: Backend proxy for manifest rewriting and CORS bypass.
- **[index.html](file:///d:/CodeVault/anidap/index.html)**: Sample testing player.

---

## ⚖️ License
Educational use only. Not for production redistribution.
