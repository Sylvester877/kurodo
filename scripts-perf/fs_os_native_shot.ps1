Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiAware {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
"@
[DpiAware]::SetProcessDPIAware() | Out-Null
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('C:/Users/sylvester/Downloads/kurodo/repo/screenshots/fs-os-native.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $($bounds.Width)x$($bounds.Height)"
