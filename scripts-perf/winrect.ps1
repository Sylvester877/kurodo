Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Rect {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[Win32Rect]::SetProcessDPIAware() | Out-Null
$p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  $r = New-Object Win32Rect+RECT
  [Win32Rect]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
  Write-Output "window rect: $($r.Left),$($r.Top) -> $($r.Right),$($r.Bottom)  (w=$($r.Right-$r.Left) h=$($r.Bottom-$r.Top))"
} else { Write-Output "no electron window" }
