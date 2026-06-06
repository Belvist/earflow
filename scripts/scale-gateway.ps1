param(
    [Parameter(Mandatory = $false)]
    [int]$Replicas = 0,

    [Parameter(Mandatory = $false)]
    [switch]$Status,

    [Parameter(Mandatory = $false)]
    [switch]$Logs
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$generated = if ($env:GENERATED_COMPOSE) { $env:GENERATED_COMPOSE } else { "docker-compose.scalable.generated.json" }
$localEdgeUrl = if ($env:LOCAL_EDGE_URL) { $env:LOCAL_EDGE_URL.TrimEnd("/") } else { "http://127.0.0.1:8085" }

function Show-Status {
    Push-Location $root
    try {
        if (Test-Path $generated) {
            docker compose -f $generated ps api-gateway nginx
        } else {
            docker compose ps api-gateway nginx
        }

        Write-Host "`nHealth via nginx: $localEdgeUrl/health"
        try { Invoke-RestMethod -Uri "$localEdgeUrl/health" -TimeoutSec 5 | ConvertTo-Json -Compress } catch { Write-Warning $_.Exception.Message }

        Write-Host "`nVersion via nginx: $localEdgeUrl/api/version"
        try { Invoke-RestMethod -Uri "$localEdgeUrl/api/version" -TimeoutSec 5 | ConvertTo-Json -Compress } catch { Write-Warning $_.Exception.Message }
    } finally {
        Pop-Location
    }
}

function Show-Logs {
    Push-Location $root
    try {
        $names = docker ps --filter "label=com.docker.compose.service=api-gateway" --format "{{.Names}}"
        foreach ($name in $names) {
            if (-not $name) { continue }
            Write-Host "`n=== $name ==="
            docker logs $name --tail 40 2>&1
        }
        Write-Host "`n=== nginx ==="
        docker logs music-nginx-lb --tail 40 2>&1
    } finally {
        Pop-Location
    }
}

function Scale-Gateway {
    param([int]$Count)
    if ($Count -lt 1) {
        throw "Replica count must be >= 1."
    }

    Push-Location $root
    try {
        .\scripts\scale-stateless.ps1 "api-gateway=$Count"
    } finally {
        Pop-Location
    }
}

if ($Logs) {
    Show-Logs
} elseif ($Status -or $Replicas -eq 0) {
    Show-Status
} else {
    Scale-Gateway -Count $Replicas
}
