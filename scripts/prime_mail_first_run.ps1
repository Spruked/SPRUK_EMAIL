param(
  [Parameter(Mandatory = $true)][string]$ShortcutLogoPng,
  [Parameter(Mandatory = $true)][string]$IconPath,
  [Parameter(Mandatory = $true)][string]$WallpaperPath,
  [Parameter(Mandatory = $true)][string]$ShortcutPath,
  [Parameter(Mandatory = $true)][string]$LauncherPath,
  [Parameter(Mandatory = $true)][string]$RunKeyPath,
  [Parameter(Mandatory = $true)][string]$RunKeyName,
  [Parameter(Mandatory = $true)][string]$FlagPath
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $ShortcutLogoPng)) {
  throw "Shortcut logo PNG not found: $ShortcutLogoPng"
}

if (!(Test-Path -LiteralPath $WallpaperPath)) {
  throw "Wallpaper image not found: $WallpaperPath"
}

$iconDir = Split-Path -Parent $IconPath
if (!(Test-Path -LiteralPath $iconDir)) {
  New-Item -ItemType Directory -Path $iconDir -Force | Out-Null
}

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($ShortcutLogoPng)
try {
  $pngBytes = [System.IO.File]::ReadAllBytes($ShortcutLogoPng)
  $fs = [System.IO.File]::Open($IconPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $bw = New-Object System.IO.BinaryWriter($fs)
  try {
    $w = [Math]::Min($img.Width, 256)
    $h = [Math]::Min($img.Height, 256)
    $widthByte = if ($w -ge 256) { 0 } else { $w }
    $heightByte = if ($h -ge 256) { 0 } else { $h }

    $bw.Write([UInt16]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]1)
    $bw.Write([Byte]$widthByte)
    $bw.Write([Byte]$heightByte)
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$pngBytes.Length)
    $bw.Write([UInt32]22)
    $bw.Write($pngBytes)
  } finally {
    $bw.Dispose()
    $fs.Dispose()
  }
} finally {
  $img.Dispose()
}

$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($ShortcutPath)
$lnk.TargetPath = $LauncherPath
$lnk.WorkingDirectory = Split-Path -Parent $LauncherPath
$lnk.IconLocation = $IconPath
$lnk.Save()

Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name Wallpaper -Value $WallpaperPath

Add-Type @"
using System.Runtime.InteropServices;
public static class NativeDisplay {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
[NativeDisplay]::SystemParametersInfo(20, 0, $WallpaperPath, 3) | Out-Null

reg add "$RunKeyPath" /v "$RunKeyName" /t REG_SZ /d "`"$LauncherPath`"" /f | Out-Null

"first_run_completed" | Set-Content -LiteralPath $FlagPath -Encoding ASCII
