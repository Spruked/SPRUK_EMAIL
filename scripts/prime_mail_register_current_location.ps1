param(
  [Parameter(Mandatory = $true)][string]$ShortcutPath,
  [Parameter(Mandatory = $true)][string]$LauncherPath,
  [Parameter(Mandatory = $true)][string]$IconPath,
  [Parameter(Mandatory = $true)][string]$RunKeyPath,
  [Parameter(Mandatory = $true)][string]$RunKeyName
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $LauncherPath
$trayScript = Join-Path $root 'scripts\prime_mail_tray.ps1'
$logoPng = Join-Path $root 'frontend\public\redVIVlogo.png'

if (-not (Test-Path -LiteralPath $trayScript)) {
  throw "VIV Communications tray supervisor not found: $trayScript"
}

# Remove legacy user-facing startup artifacts so one product identity remains.
$legacyShortcut = Join-Path $env:USERPROFILE 'Desktop\Prime Mail.lnk'
if ($legacyShortcut -ne $ShortcutPath -and (Test-Path -LiteralPath $legacyShortcut)) {
  Remove-Item -LiteralPath $legacyShortcut -Force -ErrorAction SilentlyContinue
}
$runRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (Test-Path $runRegistryPath) {
  Remove-ItemProperty -Path $runRegistryPath -Name 'PrimeMailStartup' -ErrorAction SilentlyContinue
}

# Create a usable .ico from the VIV logo when the repo does not already contain one.
if (-not (Test-Path -LiteralPath $IconPath) -and (Test-Path -LiteralPath $logoPng)) {
  try {
    Add-Type -AssemblyName System.Drawing
    $bitmap = [System.Drawing.Bitmap]::FromFile($logoPng)
    try {
      $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
      $stream = New-Object System.IO.FileStream($IconPath, [System.IO.FileMode]::Create)
      try { $icon.Save($stream) } finally { $stream.Dispose() }
    } finally {
      $bitmap.Dispose()
    }
  } catch {
    Write-Warning "Could not create VIV Communications icon: $($_.Exception.Message)"
  }
}

# Desktop shortcut launches the normal application entrypoint. That entrypoint
# refreshes registration and starts (or focuses) the tray supervisor.
$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($ShortcutPath)
$lnk.TargetPath = $LauncherPath
$lnk.WorkingDirectory = $root
$lnk.WindowStyle = 7
if (Test-Path -LiteralPath $IconPath) {
  $lnk.IconLocation = "$IconPath,0"
}
$lnk.Description = 'Start VIV Communications'
$lnk.Save()

# HKCU Run must invoke a real executable. Use powershell.exe and keep the tray
# process alive after login.
$runCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$trayScript`" -Startup"
if (-not (Test-Path $runRegistryPath)) {
  New-Item -Path $runRegistryPath -Force | Out-Null
}
Set-ItemProperty -Path $runRegistryPath -Name $RunKeyName -Value $runCommand

Write-Host "VIV Communications shortcut: $ShortcutPath"
Write-Host "VIV Communications startup: $runCommand"
