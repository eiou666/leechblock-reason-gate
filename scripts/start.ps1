[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverScript = Join-Path $PSScriptRoot "server.py"
$runtimeDir = Join-Path $projectRoot ".runtime"
$stateFile = Join-Path $runtimeDir "server-$Port.json"
$healthUrl = "http://127.0.0.1:$Port/healthz"

function Test-ReasonGateHealth {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Trim() -eq "ok"
    } catch {
        return $false
    }
}

if (Test-ReasonGateHealth) {
    Write-Host "Reason Gate is already running at http://127.0.0.1:$Port"
    exit 0
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$pythonCommand = Get-Command pythonw.exe -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
}
if (-not $pythonCommand) {
    throw "Python was not found. Install Python 3.10 or newer and enable Add Python to PATH."
}

$arguments = "`"$serverScript`" --port $Port"
$process = Start-Process -FilePath $pythonCommand.Source `
    -ArgumentList $arguments `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -PassThru

$state = [ordered]@{
    processId = $process.Id
    startedUtc = $process.StartTime.ToUniversalTime().ToString("O")
    port = $Port
}
[System.IO.File]::WriteAllText(
    $stateFile,
    ($state | ConvertTo-Json),
    [System.Text.UTF8Encoding]::new($false)
)

for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-ReasonGateHealth) {
        Write-Host "Reason Gate started at http://127.0.0.1:$Port"
        exit 0
    }
}

if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
}
Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
throw "Reason Gate failed to start on port $Port. The port may already be in use."
