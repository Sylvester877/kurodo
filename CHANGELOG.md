# Changelog

All notable Kurōdo releases are tracked here.

## [0.3.37] - 2026-09-05

### Player controls
- Added a 1.2-second cursor grace period around the video edge so controls do not flicker off when moving across the player gap.
- Controls remain visible while the cursor is over the control bar.
- Controls remain visible while paused or while playback menus are open.

### Watch layout
- Narrowed the watch sidebar on 16:10 laptop layouts to give more width back to the video player.

### Episode experience
- Redesigned episode rows with thumbnail-first layout, episode badges, synopsis, CC indicator, score, and air date.
- Added range selection and filtering to the episode list.
- Removed distracting episode-row hover zoom.

### Fullscreen and crop handling
- Fixed fullscreen video-fit behavior so automatic bar detection does not crop the picture incorrectly.
- Improved crop-boundary stability to reduce false detections during anime fades.

See the full release notes on the [v0.3.37 release](https://github.com/Sylvester877/kurodo/releases/tag/v0.3.37).

---

Older release history is available from [GitHub Releases](https://github.com/Sylvester877/kurodo/releases).
