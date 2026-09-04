[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path (Join-Path $projectRoot ".runtime") "server-$Port.json"

if (-not (Test-Path -LiteralPath $stateFile)) {
    Write-Host "No managed Reason Gate process was recorded for port $Port."
    exit 0
}

$state = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
$processId = [int]$state.processId
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue

if (-not $process) {
    Remove-Item -LiteralPath $stateFile -Force
    Write-Host "Removed a stale Reason Gate process record."
    exit 0
}

$expectedStart = if ($state.startedUtc -is [DateTime]) {
    $state.startedUtc.ToUniversalTime()
} else {
    [DateTimeOffset]::Parse([string]$state.startedUtc).UtcDateTime
}
$actualStart = $process.StartTime.ToUniversalTime()
$sameStart = [Math]::Abs(($actualStart - $expectedStart).TotalSeconds) -lt 2
$isPython = $process.ProcessName -in @("python", "pythonw")

if (-not ($sameStart -and $isPython)) {
    throw "The recorded process identity no longer matches. Refusing to stop PID $processId."
}

Stop-Process -Id $processId
Wait-Process -Id $processId -Timeout 5 -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $stateFile -Force
Write-Host "Reason Gate stopped."
