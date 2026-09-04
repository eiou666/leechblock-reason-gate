[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$startScript = Join-Path $PSScriptRoot "start.ps1"
$startupDir = [Environment]::GetFolderPath("Startup")
$launcherPath = Join-Path $startupDir "Start LeechBlock Reason Gate.cmd"
$launcher = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -Port $Port`r`n"

[System.IO.File]::WriteAllText(
    $launcherPath,
    $launcher,
    [System.Text.UTF8Encoding]::new($false)
)

& $startScript -Port $Port

Write-Host "Installed current-user startup entry: $launcherPath"
Write-Host "LeechBlock custom URL: http://127.0.0.1:$Port/lb-custom/reason-gate.html?`$S&`$U"
