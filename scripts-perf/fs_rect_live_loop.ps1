Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WR2 {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[WR2]::SetProcessDPIAware() | Out-Null
1..8 | ForEach-Object {
  $p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    $r = New-Object WR2+RECT
    [WR2]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
    Write-Output ("{0} rect {1},{2} -> {3},{4}" -f (Get-Date -Format HH:mm:ss), $r.Left, $r.Top, $r.Right, $r.Bottom)
  }
  Start-Sleep -Seconds 2
}
