param(
    [int]$Accounts = $(if ($env:DEVICE_SYNC_TEST_ACCOUNTS) { [int]$env:DEVICE_SYNC_TEST_ACCOUNTS } else { 10 }),
    [int]$Devices = $(if ($env:DEVICE_SYNC_TEST_DEVICES) { [int]$env:DEVICE_SYNC_TEST_DEVICES } else { 5 }),
    [int]$Transfers = $(if ($env:DEVICE_SYNC_TEST_TRANSFERS) { [int]$env:DEVICE_SYNC_TEST_TRANSFERS } else { 10 }),
    [int]$Concurrency = $(if ($env:DEVICE_SYNC_TEST_CONCURRENCY) { [int]$env:DEVICE_SYNC_TEST_CONCURRENCY } else { 5 }),
    [string]$Timeout = $(if ($env:DEVICE_SYNC_TEST_TIMEOUT) { $env:DEVICE_SYNC_TEST_TIMEOUT } else { "2m" })
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
    $env:DEVICE_SYNC_ENABLED = "true"
    if ([string]::IsNullOrWhiteSpace($env:DEVICE_SYNC_TEST_ACCOUNTS)) { $env:DEVICE_SYNC_TEST_ACCOUNTS = [string]$Accounts }
    if ([string]::IsNullOrWhiteSpace($env:DEVICE_SYNC_TEST_DEVICES)) { $env:DEVICE_SYNC_TEST_DEVICES = [string]$Devices }
    if ([string]::IsNullOrWhiteSpace($env:DEVICE_SYNC_TEST_TRANSFERS)) { $env:DEVICE_SYNC_TEST_TRANSFERS = [string]$Transfers }
    if ([string]::IsNullOrWhiteSpace($env:DEVICE_SYNC_TEST_CONCURRENCY)) { $env:DEVICE_SYNC_TEST_CONCURRENCY = [string]$Concurrency }
    if ([string]::IsNullOrWhiteSpace($env:DEVICE_SYNC_TEST_TIMEOUT)) { $env:DEVICE_SYNC_TEST_TIMEOUT = $Timeout }

    docker compose up -d --build redis auth-service device-sync-service
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    docker compose --profile device-sync-test run --rm device-sync-stress
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
