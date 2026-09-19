// OS-level desktop screenshot via PowerShell — ground truth of the panel,
// bypassing Chromium's own capture path entirely.
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${process.cwd().replace(/\\/g, '/')}/screenshots/fs-os-desktop.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $($bounds.Width)x$($bounds.Height)"
`
fs.writeFileSync('scripts-perf/os-shot.ps1', ps)
const out = execSync('powershell -ExecutionPolicy Bypass -File scripts-perf/os-shot.ps1', { encoding: 'utf8' })
console.log(out.trim())
