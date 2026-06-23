Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-Secret([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    }
    finally {
        $rng.Dispose()
    }
    $b64 = [Convert]::ToBase64String($buffer)
    $b64 = $b64.TrimEnd('=')
    $b64 = $b64.Replace('+', '-')
    $b64 = $b64.Replace('/', '_')
    return $b64
}

function New-HexSecret([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    }
    finally {
        $rng.Dispose()
    }
    return ([System.BitConverter]::ToString($buffer)).Replace('-', '').ToLowerInvariant()
}

function Format-PemBody([string]$Base64) {
    $clean = ($Base64 -replace '\s+', '')
    $sb = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt $clean.Length; $i += 64) {
        $len = [Math]::Min(64, $clean.Length - $i)
        [void]$sb.Append($clean.Substring($i, $len))
        [void]$sb.Append("`n")
    }
    return $sb.ToString()
}

function New-RsaKeyPairPemB64([int]$KeySizeBits) {
    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if ($node) {
        $script = @"
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: ${KeySizeBits},
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
process.stdout.write(Buffer.from(privateKey, 'utf8').toString('base64') + '\n');
process.stdout.write(Buffer.from(publicKey, 'utf8').toString('base64') + '\n');
"@

        $lines = & node -e $script
        if ($LASTEXITCODE -eq 0 -and $lines.Count -ge 2) {
            $privB64 = [string]$lines[0]
            $pubB64 = [string]$lines[1]
            if (-not [string]::IsNullOrWhiteSpace($privB64) -and -not [string]::IsNullOrWhiteSpace($pubB64)) {
                return @{ PrivateB64 = $privB64; PublicB64 = $pubB64 }
            }
        }
    }

    $rsa = [System.Security.Cryptography.RSA]::Create()
    $rsa.KeySize = $KeySizeBits

    $priv = $rsa.ExportPkcs8PrivateKey()
    $pub = $rsa.ExportSubjectPublicKeyInfo()

    $privDerB64 = [Convert]::ToBase64String($priv)
    $pubDerB64 = [Convert]::ToBase64String($pub)

    $privPem = "-----BEGIN PRIVATE KEY-----`n$(Format-PemBody $privDerB64)-----END PRIVATE KEY-----`n"
    $pubPem = "-----BEGIN PUBLIC KEY-----`n$(Format-PemBody $pubDerB64)-----END PUBLIC KEY-----`n"

    $privB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($privPem))
    $pubB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($pubPem))

    return @{ PrivateB64 = $privB64; PublicB64 = $pubB64 }
}

$ProjectDir = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $ProjectDir '.env'

$isUpdate = $false
if (Test-Path -LiteralPath $EnvPath) {
    $isUpdate = $true
    $DockerTemplate = $null
    $ExampleTemplate = $null
    $TemplatePath = $null
    $lines = Get-Content -LiteralPath $EnvPath -Encoding UTF8
}
else {
    $DockerTemplate = Join-Path $ProjectDir '.env.docker'
    $ExampleTemplate = Join-Path $ProjectDir '.env.example'

    $TemplatePath = $null
    if (Test-Path -LiteralPath $DockerTemplate) {
        $TemplatePath = $DockerTemplate
    }
    elseif (Test-Path -LiteralPath $ExampleTemplate) {
        $TemplatePath = $ExampleTemplate
    }

    $lines = @()
    if ($TemplatePath) {
        $lines = Get-Content -LiteralPath $TemplatePath -Encoding UTF8
    }
}

$required = @{
    'JWT_SECRET'                        = { New-Secret 48 }
    'SYSTEM_ROOT_SECRET'                = { New-Secret 48 }
    'MEDIA_URL_SECRET'                  = { New-Secret 48 }
    'DIRECT_STREAM_URLTOKEN_SECRET'     = { New-Secret 48 }
    'DB_PASSWORD'                       = { New-Secret 24 }
    'MINIO_ROOT_PASSWORD'               = { New-Secret 24 }
    'REDIS_PASSWORD'                    = { New-Secret 24 }
    'PGADMIN_PASSWORD'                  = { New-Secret 24 }
    'ENCRYPTION_KEY'                    = { New-HexSecret 32 }
    'EBAP_HLS_COOKIE_SECRET'            = { New-Secret 48 }
    'SERVICE_KEY_API_GATEWAY'           = { New-Secret 48 }
    'SERVICE_KEY_ARTIST_API_GATEWAY'    = { New-Secret 48 }
    'SERVICE_KEY_AUTH_SERVICE'          = { New-Secret 48 }
    'SERVICE_KEY_UPLOAD_SERVICE'        = { New-Secret 48 }
    'SERVICE_KEY_TRACK_PROCESSOR'       = { New-Secret 48 }
    'SERVICE_KEY_AUDIO_FEATURES_WORKER' = { New-Secret 48 }
    'SERVICE_KEY_EBAP_HLS_ADAPTER'      = { New-Secret 48 }
}

$defaults = @{
    'NODE_ENV'                     = 'development'
    'PUBLIC_ORIGIN'                = 'http://localhost'
    'ALLOWED_ORIGINS'              = 'http://localhost,http://127.0.0.1'
    'DB_NAME'                      = 'music_platform'
    'DB_USER'                      = 'music_user'
    'MINIO_ENDPOINT'               = 'minio'
    'MINIO_PORT'                   = '9000'
    'MINIO_USE_SSL'                = 'false'
    'MINIO_ROOT_USER'              = 'minioadmin'
    'MINIO_BUCKET_AUDIO'           = 'music-audio'
    'MINIO_BUCKET_COVERS'          = 'music-covers'
    'EBAP_TRACK_KEY_MASTER_SECRET' = ''
    'JWT_ISSUER'                   = 'earflow-auth'
    'JWT_AUDIENCE'                 = 'earflow-api'
}

$existing = @{}
foreach ($line in $lines) {
    $m = [regex]::Match($line, '^\s*([A-Z0-9_]+)=(.*)$')
    if (-not $m.Success) {
        continue
    }
    $k = $m.Groups[1].Value
    $v = $m.Groups[2].Value.Trim()
    if (-not [string]::IsNullOrWhiteSpace($k)) {
        $existing[$k] = $v
    }
}

$hasPriv = $existing.ContainsKey('SERVICE_JWT_PRIVATE_KEY_B64') -and -not [string]::IsNullOrWhiteSpace($existing['SERVICE_JWT_PRIVATE_KEY_B64'])
$hasPub = $existing.ContainsKey('SERVICE_JWT_PUBLIC_KEY_B64') -and -not [string]::IsNullOrWhiteSpace($existing['SERVICE_JWT_PUBLIC_KEY_B64'])

if ($hasPub -and -not $hasPriv) {
    throw 'SERVICE_JWT_PUBLIC_KEY_B64 is set but SERVICE_JWT_PRIVATE_KEY_B64 is missing. Refusing to rotate keys implicitly.'
}

if ($hasPriv -and -not $hasPub) {
    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if (-not $node) {
        throw 'SERVICE_JWT_PRIVATE_KEY_B64 is set but SERVICE_JWT_PUBLIC_KEY_B64 is missing, and Node.js is not available to derive the public key.'
    }

    $privB64 = $existing['SERVICE_JWT_PRIVATE_KEY_B64']
    $script = @"
const crypto = require('crypto');
const privPem = Buffer.from(process.argv[1], 'base64').toString('utf8');
const pubPem = crypto.createPublicKey(privPem).export({ type: 'spki', format: 'pem' });
process.stdout.write(Buffer.from(pubPem, 'utf8').toString('base64'));
"@
    $derivedPubB64 = & node -e $script $privB64
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($derivedPubB64)) {
        throw 'Failed to derive SERVICE_JWT_PUBLIC_KEY_B64 from SERVICE_JWT_PRIVATE_KEY_B64.'
    }

    $required['SERVICE_JWT_PUBLIC_KEY_B64'] = { $derivedPubB64 }
}

if (-not $hasPriv -and -not $hasPub) {
    $keyPair = New-RsaKeyPairPemB64 2048
    $required['SERVICE_JWT_PRIVATE_KEY_B64'] = { $keyPair.PrivateB64 }
    $required['SERVICE_JWT_PUBLIC_KEY_B64'] = { $keyPair.PublicB64 }
}

$out = New-Object System.Collections.Generic.List[string]
$seen = @{}

foreach ($line in $lines) {
    $m = [regex]::Match($line, '^(\s*)([A-Z0-9_]+)=(.*)$')
    if (-not $m.Success) {
        $out.Add($line)
        continue
    }

    $indent = $m.Groups[1].Value
    $key = $m.Groups[2].Value
    $value = $m.Groups[3].Value

    $seen[$key] = $true

    $trimmedValue = $value.Trim()

    if ($required.ContainsKey($key) -and [string]::IsNullOrWhiteSpace($trimmedValue)) {
        $gen = $required[$key]
        $out.Add("${indent}${key}=$(& $gen)")
        continue
    }

    if ($defaults.ContainsKey($key) -and [string]::IsNullOrWhiteSpace($trimmedValue)) {
        $out.Add("${indent}${key}=$($defaults[$key])")
        continue
    }

    $out.Add($line)
}

foreach ($key in $required.Keys) {
    if (-not $seen.ContainsKey($key)) {
        $gen = $required[$key]
        $out.Add("${key}=$(& $gen)")
    }
}

foreach ($key in $defaults.Keys) {
    if (-not $seen.ContainsKey($key)) {
        $out.Add("${key}=$($defaults[$key])")
    }
}

[IO.File]::WriteAllText($EnvPath, ($out -join "`n") + "`n", (New-Object System.Text.UTF8Encoding($false)))
if ($isUpdate) {
    Write-Host 'Updated .env (filled missing values only).'
}
else {
    if ($TemplatePath) {
        Write-Host "Created .env from $([IO.Path]::GetFileName($TemplatePath))."
    }
    else {
        Write-Host 'Created .env (no template found; generated defaults and secrets).'
    }
}
Write-Host 'Next: docker compose up -d'
