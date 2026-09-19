// The stable 160px left bar — check Windows display topology.
// CopyFromScreen uses PHYSICAL pixels; PrimaryScreen.Bounds is in DIPs.
// At 125% scaling: Bounds=1536x960 DIP but the capture writes 1536x960
// PIXELS = only 80% of the physical 1920px width → the shot is the
// top-left 1536x960 crop of a 1920x1200 panel!
// Verify: physical res via wmic + compare with earlier 1920x1200 captures.
import { execSync } from 'node:child_process'

const out = execSync('wmic desktopmonitor get screenwidth,screenheight 2>nul & wmic path Win32_VideoController get CurrentHorizontalResolution,CurrentVerticalResolution 2>nul', { encoding: 'utf8' })
console.log(out)
console.log('---')
console.log('If physical = 1920x1200 and our OS shots are 1536x960, then')
console.log('CopyFromScreen captured only the top-left 80% of the panel —')
console.log('which explains a "left bar" of 0 and any right-side content')
console.log('misplacement. The earlier 1920x1200 shots came from Chromium.')
console.log('')
console.log('Earlier OS shots at 1536x960 showed PIC 159..1535 — that "159px')
console.log('left bar" is the OTHER 80%: the full physical row is 1920, we')
console.log('captured 1536 = x0..1535 physical. PIC starting at 159 PHYSICAL px')
console.log('= 159/1.25 = 127 CSS px. Something IS 127 CSS px black on the')
console.log('left OR the video really is shifted right. Right edge = capture')
console.log('edge (1535 physical = 1228 CSS), NOT the panel edge — so right')
console.log('measurements in OS shots are meaningless beyond x=1228 CSS!')
console.log('')
console.log('REAL check must be done in Chromium pixels (0..1536) — which showed')
console.log('video rect 0..1536 EXACTLY, cover, centered. Layout confirmed good.')
