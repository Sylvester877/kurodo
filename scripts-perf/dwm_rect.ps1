Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DwmQ {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int size);
  [DllImport("user32.dll")]
  public static extern IntPtr FindWindowW(string cls, string title);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[DwmQ]::SetProcessDPIAware() | Out-Null
$p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  $h = $p.MainWindowHandle
  $r = New-Object DwmQ+RECT
  $hr = [DwmQ]::DwmGetWindowAttribute($h, 9, [ref]$r, 16)  # DWMWA_EXTENDED_FRAME_BOUNDS
  Write-Output ("dwm extended bounds: {0},{1} -> {2},{3} (w={4} h={5}) hr={6}" -f $r.Left, $r.Top, $r.Right, $r.Bottom, ($r.Right-$r.Left), ($r.Bottom-$r.Top), $hr)
  $title = $p.MainWindowTitle
  Write-Output ("title: " + $title)
} else { Write-Output "no electron window" }
# monitor info
Add-Type -AssemblyName System.Windows.Forms
$s = [System.Windows.Forms.Screen]::PrimaryScreen
Write-Output ("screen bounds (DPI-aware now): {0},{1} {2}x{3}" -f $s.Bounds.X, $s.Bounds.Y, $s.Bounds.Width, $s.Bounds.Height)
