# Earflow frontend delivery verification — exit 1 on any failure
$ErrorActionPreference = "Stop"
$frontendRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $frontendRoot

Set-Location $frontendRoot
Write-Host "== build ==" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "== unit tests ==" -ForegroundColor Cyan
npm run test:unit:ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "== e2e homepage ==" -ForegroundColor Cyan
npx playwright test e2e/homepage-health.spec.js e2e/homepage-gestures.spec.js --reporter=line
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Set-Location $repoRoot
Write-Host "== validate:ai ==" -ForegroundColor Cyan
npm run validate:ai
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "All delivery checks passed." -ForegroundColor Green
