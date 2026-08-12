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
$logoPng = Join-Path $root 'frontend\public\primemail-logo.png'

if (-not (Test-Path -LiteralPath $trayScript)) {
  throw "PRIME MAIL tray supervisor not found: $trayScript"
}

# Create a usable .ico from the PRIME MAIL logo when the repo does not already
# contain one. Startup must not depend on the old R-drive installation having
# generated an icon previously.
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
    Write-Warning "Could not create PRIME MAIL icon: $($_.Exception.Message)"
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
$lnk.Description = 'Start PRIME MAIL'
$lnk.Save()

# HKCU Run must invoke a real executable. Pointing the Run value directly at a
# .bat file is unreliable on Windows because the Run key is not a cmd.exe shell.
# Use powershell.exe as the executable and keep the tray process alive after login.
$runCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$trayScript`" -Startup"
$runRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (-not (Test-Path $runRegistryPath)) {
  New-Item -Path $runRegistryPath -Force | Out-Null
}
Set-ItemProperty -Path $runRegistryPath -Name $RunKeyName -Value $runCommand

Write-Host "PRIME MAIL shortcut: $ShortcutPath"
Write-Host "PRIME MAIL startup: $runCommand"
