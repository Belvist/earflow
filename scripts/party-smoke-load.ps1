param(
    [string]$StateUrl = $(if ($env:PARTY_STATE_URL) { $env:PARTY_STATE_URL } else { "http://localhost:3130" }),
    [string]$WsUrl = $(if ($env:PARTY_WS_URL) { $env:PARTY_WS_URL } else { "ws://localhost:3131/ws/v2" }),
    [int]$Rooms = $(if ($env:PARTY_TEST_ROOMS) { [int]$env:PARTY_TEST_ROOMS } else { 2 }),
    [int]$Guests = $(if ($env:PARTY_TEST_GUESTS) { [int]$env:PARTY_TEST_GUESTS } else { 4 }),
    [int]$Updates = $(if ($env:PARTY_TEST_UPDATES) { [int]$env:PARTY_TEST_UPDATES } else { 8 }),
    [int]$Concurrency = $(if ($env:PARTY_TEST_CONCURRENCY) { [int]$env:PARTY_TEST_CONCURRENCY } else { 2 }),
    [string]$Timeout = $(if ($env:PARTY_TEST_TIMEOUT) { $env:PARTY_TEST_TIMEOUT } else { "90s" }),
    [string]$StepTimeout = $(if ($env:PARTY_TEST_STEP_TIMEOUT) { $env:PARTY_TEST_STEP_TIMEOUT } else { "6s" }),
    [string]$Think = $(if ($env:PARTY_TEST_THINK) { $env:PARTY_TEST_THINK } else { "80ms" }),
    [ValidateSet("auto", "direct", "docker")]
    [string]$Mode = $(if ($env:PARTY_TEST_MODE) { $env:PARTY_TEST_MODE } else { "auto" }),
    [switch]$VerboseParty
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$PartyGo = Join-Path $Root "backend\party-go"

function Test-PartyHttpOk {
    param([string]$Url)
    try {
        Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

function Get-PartyComposeNetwork {
    Push-Location $Root
    try {
        $cid = docker compose ps -q party-state-service 2>$null | Select-Object -First 1
        if (-not $cid) {
            return $null
        }

        $network = docker inspect $cid --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' 2>$null | Select-Object -First 1
        if (-not $network) {
            return $null
        }
        return $network.Trim()
    }
    finally {
        Pop-Location
    }
}

function Invoke-PartyDirect {
    Push-Location $PartyGo
    try {
        $args = @(
            "run", "./cmd/party-smoke-load",
            "-state-url", $StateUrl,
            "-ws-url", $WsUrl,
            "-rooms", "$Rooms",
            "-guests", "$Guests",
            "-updates", "$Updates",
            "-concurrency", "$Concurrency",
            "-timeout", $Timeout,
            "-step-timeout", $StepTimeout,
            "-think", $Think
        )
        if ($VerboseParty -or ($env:PARTY_TEST_VERBOSE -in @("1", "true", "yes", "on"))) {
            $args += "-v"
        }
        & go @args
    }
    finally {
        Pop-Location
    }
}

function Invoke-PartyDocker {
    $network = Get-PartyComposeNetwork
    if (-not $network) {
        throw "Cannot find compose network from party-state-service. Start services first: docker compose up -d party-state-service party-gateway-service"
    }

    $verboseValue = if ($VerboseParty -or ($env:PARTY_TEST_VERBOSE -in @("1", "true", "yes", "on"))) { "true" } else { "false" }
    & docker run --rm `
        --network $network `
        -v "${PartyGo}:/work" `
        -w /work `
        -e "PARTY_TEST_ROOMS=$Rooms" `
        -e "PARTY_TEST_GUESTS=$Guests" `
        -e "PARTY_TEST_UPDATES=$Updates" `
        -e "PARTY_TEST_CONCURRENCY=$Concurrency" `
        -e "PARTY_TEST_TIMEOUT=$Timeout" `
        -e "PARTY_TEST_STEP_TIMEOUT=$StepTimeout" `
        -e "PARTY_TEST_THINK=$Think" `
        -e "PARTY_TEST_VERBOSE=$verboseValue" `
        golang:1.22-alpine `
        sh -lc 'go run ./cmd/party-smoke-load -state-url http://party-state-service:3130 -ws-url ws://party-gateway-service:3131/ws/v2 -rooms "$PARTY_TEST_ROOMS" -guests "$PARTY_TEST_GUESTS" -updates "$PARTY_TEST_UPDATES" -concurrency "$PARTY_TEST_CONCURRENCY" -timeout "$PARTY_TEST_TIMEOUT" -step-timeout "$PARTY_TEST_STEP_TIMEOUT" -think "$PARTY_TEST_THINK" $(if [ "$PARTY_TEST_VERBOSE" = "true" ]; then printf -- "-v"; fi)'
}

if ($Mode -eq "direct") {
    Invoke-PartyDirect
}
elseif ($Mode -eq "docker") {
    Invoke-PartyDocker
}
else {
    if (Test-PartyHttpOk "$StateUrl/health") {
        Invoke-PartyDirect
    }
    else {
        Write-Warning "party-state is not reachable at $StateUrl/health; running smoke test inside compose network."
        Invoke-PartyDocker
    }
}
