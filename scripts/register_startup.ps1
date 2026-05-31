# PowerShell script to register Prime Mail backend and frontend to start at user login
# This script creates shortcuts in the user's Startup folder for both backend and frontend

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendScript = Join-Path $projectRoot 'start_backend.bat'
$frontendScript = Join-Path $projectRoot 'start_frontend.bat'

$WshShell = New-Object -ComObject WScript.Shell
$startup = [Environment]::GetFolderPath('Startup')

# Backend shortcut
$backendShortcut = Join-Path $startup 'PrimeMail_Backend.lnk'
$shortcut = $WshShell.CreateShortcut($backendShortcut)
$shortcut.TargetPath = $backendScript
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Save()

# Frontend shortcut
$frontendShortcut = Join-Path $startup 'PrimeMail_Frontend.lnk'
$shortcut = $WshShell.CreateShortcut($frontendShortcut)
$shortcut.TargetPath = $frontendScript
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Save()

Write-Host 'Prime Mail backend and frontend will now start automatically at login.'
