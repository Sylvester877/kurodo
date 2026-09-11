# BUGLEDGER

| # | SEV | Status | Root cause | Fix | Commit |
|---|-----|--------|-----------|-----|--------|
| 1 | SEV-1 | FIXED | useSettings object selector w/o useShallow → infinite render in new CharactersRow | zustand useShallow | 45a148f |
| 2 | SEV-2 | FIXED | Jikan negative cache 502'd for 30s without trying AniList → empty Browse | race AniList fallback on neg-cache hit | 63118cd |
| 3 | SEV-1 | FIXED | Electron permission handler denied 'fullscreen' → requestFullscreen hangs | allow fullscreen permission | 2fe2164 |
| 4 | SEV-2 | FIXED | Baked letterbox bars visible in fullscreen in all fit modes (crop disabled) | fullscreen zoom-crop of detected bars | 194ec09 |
| 5 | SEV-4 | FIXED | fonts.googleapis.com stylesheet refused (style-src missing host) | style-src += fonts.googleapis.com | 1a28f23 |
| 6 | SEV-3 | WATCH | Jikan+AniList dual outage (env): Browse shows error state; by-design 502 after both fail | — | — |
| 7 | SEV-3 | FIXED | Home feed "Trending" row was plain grid — ghost-numeral rail built (TrendingRail.tsx, GhostNumeral, 18 numerals) | TrendingRail + SectionHeader + RailPaging | d0807e2 |
| 8 | SEV-2 | FIXED | Footer link /music had no route → 404 | reroute to /seasonal (Footer.tsx) | a8448b4 |
