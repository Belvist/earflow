param(
    [Parameter(Mandatory = $false)]
    [string[]]$ComposeFiles = @("docker-compose.yml"),

    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
    [string[]]$Scale
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$generated = if ($env:GENERATED_COMPOSE) { $env:GENERATED_COMPOSE } else { "docker-compose.scalable.generated.json" }

if ($Scale.Count -eq 0) {
    throw "Usage: .\scripts\scale-stateless.ps1 api-gateway=4 frontend=2"
}

$blocked = @(
    "postgres",
    "redis",
    "redis-auth",
    "minio",
    "meilisearch",
    "nats",
    "nginx",
    "pgbouncer",
    "certbot",
    "nginx-cert-reloader",
    "minio-init",
    "portainer",
    "pgadmin",
    "track-processor",
    "audio-features-worker",
    "reco-offline-worker",
    "reco-feedback-loadgen",
    "integration-tests",
    "upload-service-tests"
)
$scaleArgs = @()
foreach ($pair in $Scale) {
    if ($pair -notmatch "^[a-zA-Z0-9_.-]+=[0-9]+$") {
        throw "Invalid scale argument: $pair. Expected service=count."
    }
    $service, $countRaw = $pair.Split("=", 2)
    if ($blocked -contains $service) {
        throw "Refusing to scale stateful/edge service with this script: $service"
    }
    $count = [int]$countRaw
    if ($count -lt 1) {
        throw "Replica count must be >= 1 in: $pair"
    }
    $scaleArgs += "--scale"
    $scaleArgs += "$service=$count"
}

Push-Location $root
try {
    .\scripts\render-scalable-compose.ps1 -Output $generated -ComposeFiles $ComposeFiles
    docker compose -f $generated up -d @scaleArgs

    $nginx = docker ps --filter "name=music-nginx-lb" --format "{{.Names}}"
    if ($nginx -contains "music-nginx-lb") {
        docker exec music-nginx-lb nginx -s reload | Out-Null
    }

    docker compose -f $generated ps
} finally {
    Pop-Location
}
