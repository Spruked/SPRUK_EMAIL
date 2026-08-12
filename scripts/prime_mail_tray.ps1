param(
  [switch]$Startup,
  [switch]$EnsureBuild
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VivMailNativeIcon {
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr handle);
}
'@

$root = Split-Path -Parent $PSScriptRoot
$backendBatch = Join-Path $root 'start_backend.bat'
$frontendDir = Join-Path $root 'frontend'
$buildIndex = Join-Path $frontendDir 'build\index.html'
$iconPath = Join-Path $root 'frontend\public\redVIVlogo.png'
$logDir = Join-Path $env:LOCALAPPDATA 'PrimeMail'
$logFile = Join-Path $logDir 'tray.log'
$port = 19000
$uri = 'http://127.0.0.1:19000'

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-TrayLog([string]$Message) {
  try {
    Add-Content -LiteralPath $logFile -Value ("{0:u} {1}" -f (Get-Date), $Message) -Encoding UTF8
  } catch {}
}

function Get-PngTrayIcon([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $bitmap = $null
  $sourceIcon = $null
  $handle = [IntPtr]::Zero
  try {
    $bitmap = New-Object System.Drawing.Bitmap($Path)
    $handle = $bitmap.GetHicon()
    $sourceIcon = [System.Drawing.Icon]::FromHandle($handle)
    return $sourceIcon.Clone()
  } catch {
    Write-TrayLog "Tray icon load failed: $($_.Exception.Message)"
    return $null
  } finally {
    if ($sourceIcon) { $sourceIcon.Dispose() }
    if ($handle -ne [IntPtr]::Zero) { [void][VivMailNativeIcon]::DestroyIcon($handle) }
    if ($bitmap) { $bitmap.Dispose() }
  }
}

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\PrimeMailTraySupervisor', [ref]$createdNew)
if (-not $createdNew) {
  if (-not $Startup) {
    try { Start-Process $uri | Out-Null } catch {}
  }
  exit 0
}

function Test-MailPort {
  try {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1)
  } catch {
    return $false
  }
}

function Ensure-FrontendBuild {
  $needsBuild = $EnsureBuild -or -not (Test-Path -LiteralPath $buildIndex)
  if (-not $needsBuild) { return $true }

  $packageJson = Join-Path $frontendDir 'package.json'
  if (-not (Test-Path -LiteralPath $packageJson)) {
    Write-TrayLog "Frontend package.json missing: $packageJson"
    return $false
  }

  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) {
    Write-TrayLog 'npm.cmd was not found on PATH; keeping any existing frontend build.'
    return (Test-Path -LiteralPath $buildIndex)
  }

  Write-TrayLog 'Building VIV Mail frontend.'
  Push-Location $frontendDir
  try {
    & $npm.Source run build *>> $logFile
    if ($LASTEXITCODE -ne 0) {
      Write-TrayLog "Frontend build failed with exit code $LASTEXITCODE."
      return (Test-Path -LiteralPath $buildIndex)
    }
    Write-TrayLog 'Frontend build completed.'
    return $true
  } catch {
    Write-TrayLog "Frontend build exception: $($_.Exception.Message)"
    return (Test-Path -LiteralPath $buildIndex)
  } finally {
    Pop-Location
  }
}

function Start-MailBackend {
  if (Test-MailPort) { return }
  if (-not (Test-Path -LiteralPath $backendBatch)) {
    Write-TrayLog "Backend launcher missing: $backendBatch"
    return
  }

  Write-TrayLog 'Starting VIV Mail backend.'
  Start-Process -FilePath $env:ComSpec `
    -ArgumentList @('/c', ('"{0}"' -f $backendBatch)) `
    -WorkingDirectory $root `
    -WindowStyle Hidden | Out-Null
}

function Stop-MailBackend {
  try {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object {
        if ($_ -and $_ -ne $PID) {
          Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        }
      }
    Write-TrayLog 'Stopped VIV Mail backend listener.'
  } catch {
    Write-TrayLog "Stop backend failed: $($_.Exception.Message)"
  }
}

function Open-PrimeMail {
  try { Start-Process $uri | Out-Null } catch { Write-TrayLog "Open browser failed: $($_.Exception.Message)" }
}

[System.Windows.Forms.Application]::EnableVisualStyles()
$notify = New-Object System.Windows.Forms.NotifyIcon
$trayIcon = Get-PngTrayIcon $iconPath
if ($trayIcon) {
  $notify.Icon = $trayIcon
} else {
  $notify.Icon = [System.Drawing.SystemIcons]::Application
}
$notify.Text = 'VIV Mail'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$statusItem.Enabled = $false
[void]$menu.Items.Add($statusItem)

$openItem = New-Object System.Windows.Forms.ToolStripMenuItem('Open VIV Mail')
$openItem.Add_Click({ Open-PrimeMail })
[void]$menu.Items.Add($openItem)

$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem('Restart VIV Mail')
$restartItem.Add_Click({
  Stop-MailBackend
  Start-Sleep -Milliseconds 750
  Start-MailBackend
})
[void]$menu.Items.Add($restartItem)

$logsItem = New-Object System.Windows.Forms.ToolStripMenuItem('Open startup log')
$logsItem.Add_Click({
  if (Test-Path -LiteralPath $logFile) { Start-Process notepad.exe -ArgumentList ('"{0}"' -f $logFile) | Out-Null }
})
[void]$menu.Items.Add($logsItem)

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$stopItem = New-Object System.Windows.Forms.ToolStripMenuItem('Stop VIV Mail')
$stopItem.Add_Click({ Stop-MailBackend })
[void]$menu.Items.Add($stopItem)

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem('Exit tray')
$exitItem.Add_Click({
  $notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
[void]$menu.Items.Add($exitItem)

$notify.ContextMenuStrip = $menu
$notify.Add_DoubleClick({ Open-PrimeMail })

function Update-Status {
  if (Test-MailPort) {
    $statusItem.Text = 'Status: running on 19000'
    $notify.Text = 'VIV Mail - running'
  } else {
    $statusItem.Text = 'Status: stopped'
    $notify.Text = 'VIV Mail - stopped'
  }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({ Update-Status })

try {
  $buildReady = Ensure-FrontendBuild
  if (-not $buildReady) { Write-TrayLog 'No usable frontend build was confirmed.' }
  Start-MailBackend
  Update-Status
  $timer.Start()
  Write-TrayLog "Tray supervisor active. Startup=$Startup EnsureBuild=$EnsureBuild"
  [System.Windows.Forms.Application]::Run()
} finally {
  try { $timer.Stop(); $timer.Dispose() } catch {}
  try { $notify.Visible = $false; $notify.Dispose() } catch {}
  try { if ($trayIcon) { $trayIcon.Dispose() } } catch {}
  try { $mutex.ReleaseMutex(); $mutex.Dispose() } catch {}
}
