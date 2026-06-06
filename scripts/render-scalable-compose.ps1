param(
    [Parameter(Mandatory = $false)]
    [string]$Output = "docker-compose.scalable.generated.json",

    [Parameter(Mandatory = $false)]
    [string]$Services = "",

    [Parameter(Mandatory = $false)]
    [switch]$KeepPublishedPorts,

    [Parameter(Mandatory = $false)]
    [string[]]$ComposeFiles = @("docker-compose.yml")
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $root
try {
    function Write-Utf8NoBom {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Path,

            [Parameter(Mandatory = $true)]
            [AllowEmptyString()]
            [string]$Text
        )

        $fullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
        $encoding = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($fullPath, $Text, $encoding)
    }

    $args = @()
    if ($Services.Trim() -ne "") {
        $args += "--services=$Services"
    }
    if ($KeepPublishedPorts) {
        $args += "--keep-published-ports"
    }

    $composeArgs = @()
    foreach ($file in $ComposeFiles) {
        if ([string]::IsNullOrWhiteSpace($file)) { continue }
        $composeArgs += "-f"
        $composeArgs += $file
    }
    if ($composeArgs.Count -eq 0) {
        $composeArgs = @("-f", "docker-compose.yml")
    }

    if (Get-Command node -ErrorAction SilentlyContinue) {
        $rendered = docker compose @composeArgs config --format json | node scripts/render-scalable-compose.js @args | Out-String
    } else {
        $rendered = docker compose @composeArgs config --format json | docker run --rm -i -v "$root/scripts:/scripts:ro" node:22-alpine node /scripts/render-scalable-compose.js @args | Out-String
    }

    if ([string]::IsNullOrWhiteSpace($rendered)) {
        throw "Renderer produced an empty compose config."
    }

    Write-Utf8NoBom -Path $Output -Text $rendered
    docker compose -f $Output config | Out-Null
    Write-Host "Generated $Output from $($ComposeFiles -join ',')"
} finally {
    Pop-Location
}
