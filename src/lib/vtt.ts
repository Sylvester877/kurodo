/**
 * Parse a WebVTT timestamp into milliseconds.
 * Supports both HH:MM:SS.mmm and MM:SS.mmm formats.
 */
export function parseVttTimestamp(ts: string): number {
  // WebVTT allows both HH:MM:SS.mmm and MM:SS.mmm
  let m = ts.match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/)
  if (m) {
    return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4])
  }
  m = ts.match(/^(\d{2}):(\d{2})[,.](\d{3})$/)
  if (m) {
    return Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(m[3])
  }
  return 0
}

/**
 * Format milliseconds back into a WebVTT-compliant timestamp string.
 */
export function formatVttTimestamp(ms: number, sep: string): string {
  const clamped = Math.max(0, ms)
  const h = Math.floor(clamped / 3600000)
  const m = Math.floor((clamped % 3600000) / 60000)
  const s = Math.floor((clamped % 60000) / 1000)
  const f = Math.round(clamped % 1000)
  // Use MM:SS.mmm format when under 1 hour (WebVTT standard)
  if (h === 0) {
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(f).padStart(3, '0')}`
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(f).padStart(3, '0')}`
}

/**
 * Apply a time offset to WebVTT cue timing lines ONLY.
 * This only matches the cue timing pattern (HH:MM:SS.mmm --> HH:MM:SS.mmm)
 * and ignores timestamps that appear inside subtitle text content.
 */
export function applyVttOffset(vtt: string, offsetSeconds: number): string {
  if (offsetSeconds === 0) return vtt
  const offsetMs = Math.round(offsetSeconds * 1000)
  // Match cue timing lines in BOTH formats, preserving optional cue settings:
  //   HH:MM:SS.mmm --> HH:MM:SS.mmm  (long videos)
  //   MM:SS.mmm --> MM:SS.mmm        (short videos, common in anime)
  const timingLineRe = /^(\d{2}:(?:\d{2}:)?\d{2})[,.](\d{3})\s+-->\s+(\d{2}:(?:\d{2}:)?\d{2})[,.](\d{3})(.*)$/gm
  return vtt.replace(timingLineRe, (_match, startTime, startMs, endTime, endMs, rest) => {
    const newStartMs = parseVttTimestamp(`${startTime}.${startMs}`) + offsetMs
    const endMsAfterOffset = parseVttTimestamp(`${endTime}.${endMs}`) + offsetMs
    const newEndMs = Math.max(endMsAfterOffset, newStartMs + 1)
    return `${formatVttTimestamp(newStartMs, '.')} --> ${formatVttTimestamp(newEndMs, '.')}${rest || ''}`
  })
}
