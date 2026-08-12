param(
  [Parameter(Mandatory = $true)][string]$ShortcutPath,
  [Parameter(Mandatory = $true)][string]$LauncherPath,
  [Parameter(Mandatory = $true)][string]$IconPath,
  [Parameter(Mandatory = $true)][string]$RunKeyPath,
  [Parameter(Mandatory = $true)][string]$RunKeyName
)

$ErrorActionPreference = "Stop"

$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($ShortcutPath)
$lnk.TargetPath = $LauncherPath
$lnk.WorkingDirectory = Split-Path -Parent $LauncherPath
if (Test-Path -LiteralPath $IconPath) {
  $lnk.IconLocation = $IconPath
}
$lnk.Save()

reg add "$RunKeyPath" /v "$RunKeyName" /t REG_SZ /d "`"$LauncherPath`"" /f | Out-Null

Write-Host "Prime Mail launcher registered at: $LauncherPath"
