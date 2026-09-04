[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$startupDir = [Environment]::GetFolderPath("Startup")
$launcherPath = Join-Path $startupDir "Start LeechBlock Reason Gate.cmd"
$stopScript = Join-Path $PSScriptRoot "stop.ps1"

if (Test-Path -LiteralPath $launcherPath) {
    Remove-Item -LiteralPath $launcherPath -Force
    Write-Host "Removed current-user startup entry."
}

& $stopScript -Port $Port
Write-Host "Project files were preserved. Remove the repository manually if no longer needed."
