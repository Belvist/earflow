param(
    [string]$BaseUrl = $env:DEVICE_SYNC_URL,
    [string]$UserId = $env:DEVICE_SYNC_TEST_USER_ID,
    [string]$Timeout = $env:DEVICE_SYNC_TEST_TIMEOUT,
    [int]$Accounts = $(if ($env:DEVICE_SYNC_TEST_ACCOUNTS) { [int]$env:DEVICE_SYNC_TEST_ACCOUNTS } else { 10 }),
    [int]$Devices = $(if ($env:DEVICE_SYNC_TEST_DEVICES) { [int]$env:DEVICE_SYNC_TEST_DEVICES } else { 5 }),
    [int]$Transfers = $(if ($env:DEVICE_SYNC_TEST_TRANSFERS) { [int]$env:DEVICE_SYNC_TEST_TRANSFERS } else { 10 }),
    [int]$Concurrency = $(if ($env:DEVICE_SYNC_TEST_CONCURRENCY) { [int]$env:DEVICE_SYNC_TEST_CONCURRENCY } else { 5 })
)

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    $BaseUrl = "http://localhost:3050"
}
if ([string]::IsNullOrWhiteSpace($UserId)) {
    $UserId = "device-sync-smoke"
}
if ([string]::IsNullOrWhiteSpace($Timeout)) {
    $Timeout = "30s"
}

$root = Split-Path -Parent $PSScriptRoot
$serviceDir = Join-Path $root "backend/device-sync-service"

Push-Location $serviceDir
try {
    go run ./cmd/device-sync-smoke `
        -base-url $BaseUrl `
        -user-id $UserId `
        -accounts $Accounts `
        -devices $Devices `
        -transfers $Transfers `
        -concurrency $Concurrency `
        -timeout $Timeout
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
