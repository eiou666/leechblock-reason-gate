[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$baseUrl = "http://127.0.0.1:$Port"
$health = Invoke-WebRequest -Uri "$baseUrl/healthz" -UseBasicParsing -TimeoutSec 5
$page = Invoke-WebRequest -Uri "$baseUrl/lb-custom/reason-gate.html?test" -UseBasicParsing -TimeoutSec 5
$html = $page.Content
$gateScript = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\leechblock-shared\blocked.js')

$checks = [ordered]@{
    health = $health.StatusCode -eq 200 -and $health.Content.Trim() -eq "ok"
    pageStatus = $page.StatusCode -eq 200
    oneTextarea = ([regex]::Matches($html, "<textarea\b").Count -eq 1)
    oneButton = ([regex]::Matches($html, "<button\b").Count -eq 1)
    noPlaceholder = $html -notmatch "placeholder="
    fiveCharacterRule = $gateScript -match "length < 5"
    inlineGate = $html -match 'data-lb-reason-gate="inline-v1"'
    initiallyDisabled = $html -match '<button[^>]+id="submit"[^>]+disabled'
    noCountdownElement = $html -notmatch 'lbDelaySeconds'
    noReloadTransition = $html -notmatch 'location.reload|sessionStorage'
}

$checks.GetEnumerator() | ForEach-Object {
    "{0,-20} {1}" -f $_.Key, $(if ($_.Value) { "PASS" } else { "FAIL" })
}

if ($checks.Values -contains $false) {
    throw "One or more Reason Gate checks failed."
}

Write-Host "All Reason Gate checks passed."
