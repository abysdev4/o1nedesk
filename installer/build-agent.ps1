# Compila o agente OneDesk como executavel unico, self-contained (sem depender de .NET instalado no cliente)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$agent = Join-Path $root "agent"

Write-Host "==> Publicando OneDeskAgent (win-x64, self-contained, single file)..." -ForegroundColor Cyan
Push-Location $agent
try {
    dotnet publish OneDeskAgent.csproj -c Release -r win-x64 `
        -p:PublishSingleFile=true -p:SelfContained=true -p:IncludeNativeLibrariesForSelfExtract=true `
        --output (Join-Path $agent "publish")
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish falhou (exit $LASTEXITCODE)" }
}
finally { Pop-Location }

$exe = Join-Path $agent "publish\OneDeskAgent.exe"
if (Test-Path $exe) {
    $size = [math]::Round((Get-Item $exe).Length / 1MB, 1)
    Write-Host "==> OK: $exe ($size MB)" -ForegroundColor Green
} else {
    throw "Executavel nao encontrado em $exe"
}
