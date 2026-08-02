# Kurodo Video Playback Test Results
**Date:** June 29, 2026
**Provider:** Anidap (DOM extraction via Puppeteer)

## ✅ One Piece - Episode 1
- **Server:** Kami (also confirmed working: Nuri)
- **Stream URL:** `https://bd.24stream.xyz/media/cachehd/21eop1web/index.m3u8`
- **Status:** Playing anime content successfully
- **Load time:** ~5-7 seconds for video element to appear after navigation

## ✅ Jujutsu Kaisen - Episode 1  
- **Server:** Nuri (also confirmed working: Kami)
- **Stream URL:** `https://bd.24stream.xyz/media/cachehd/20260617013011720p28055841282330035/index.m3u8`
- **Status:** Playing anime content successfully

## Architecture
- **Method:** Pure DOM extraction via headless Chrome (Puppeteer)
- **Flow:** Navigate to `anidap.se/watch?id={anilistId}&ep={ep}&type={type}&provider={provider}` → wait for `<video>` element → extract `src`
- **chad REST API:** Dead as of June 2026 (returns "anime not found" for all anime)
- **old anidap API:** Blocks with bot detection ("YOUR GAY!")

## Server Status (from health check probe)
| Server | One Piece | Jujutsu Kaisen |
|--------|-----------|----------------|
| yuki   | ❌ DOWN   | ❌ DOWN         |
| koto   | ❌ DOWN   | ❌ DOWN         |
| nuri   | ✅ 6573ms | ✅ 7550ms       |
| kami   | ✅ 4269ms | ✅ 5003ms       |
