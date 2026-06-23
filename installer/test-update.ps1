<#
  Testa o pipeline de auto-update: manifesto, GitHub Releases, hub fallback, SHA.
  Uso: installer\test-update.ps1
#>
$ErrorActionPreference = "Stop"

Write-Host "==> 1. Manifesto de versao (Vercel)" -ForegroundColor Cyan
$manifest = Invoke-RestMethod "https://onedesk-gamma.vercel.app/api/agent/version"
$manifest | ConvertTo-Json
$sha = $manifest.sha256
$ghUrl = $manifest.downloadUrl

Write-Host ""
Write-Host "==> 2. Download GitHub Releases (fonte principal)" -ForegroundColor Cyan
if (-not $ghUrl) {
  Write-Host "   AVISO: downloadUrl ausente no manifesto" -ForegroundColor Yellow
} else {
  Write-Host "   url: $ghUrl"
  try {
    $code = curl.exe -s -o NUL -w "%{http_code}" --max-time 20 -I $ghUrl
    if ($code -match "^[23]") { Write-Host "   HEAD OK ($code)" -ForegroundColor Green }
    else { Write-Host "   HEAD falhou ($code) - release ainda nao publicado?" -ForegroundColor Yellow }
  } catch {
    Write-Host "   HEAD falhou: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "==> 3. Hub registrado (fallback)" -ForegroundColor Cyan
$status = Invoke-RestMethod "https://onedesk-gamma.vercel.app/api/hub/status"
$hubHttp = ($status.url -replace '^wss://', 'https://')
Write-Host "   url: $hubHttp (online=$($status.online), reachable=$($status.reachable))"

if ($status.reachable) {
  Write-Host ""
  Write-Host "==> 4. Health do hub" -ForegroundColor Cyan
  try {
    $health = Invoke-RestMethod "$hubHttp/health" -TimeoutSec 15
    Write-Host "   OK: $($health | ConvertTo-Json -Compress)" -ForegroundColor Green
  } catch {
    Write-Host "   FALHOU: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "==> 5. Teste download (primeiros 1 MB + SHA completo se -FullDownload)" -ForegroundColor Cyan
$downloadUrl = if ($ghUrl) { $ghUrl } elseif ($status.reachable) { "$hubHttp/download/agent" } else { $null }
if (-not $downloadUrl) {
  Write-Host "   ERRO: nenhuma fonte de download disponivel" -ForegroundColor Red
  exit 1
}

$tmp = Join-Path $env:TEMP "onedesk-update-test.exe"
if ($args -contains "-FullDownload") {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  Invoke-WebRequest -Uri $downloadUrl -OutFile $tmp -UseBasicParsing -TimeoutSec 600
  $sw.Stop()
  $dlSha = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
  Write-Host "   baixado em $([int]$sw.Elapsed.TotalSeconds)s"
  Write-Host "   sha256: $dlSha"
  if ($sha -and $dlSha -ne $sha.ToLower()) {
    Write-Host "   ERRO: SHA difere do manifesto!" -ForegroundColor Red
    exit 1
  }
  Write-Host "   SHA OK" -ForegroundColor Green
  Remove-Item $tmp -Force
} else {
  Write-Host "   fonte: $downloadUrl"
  Write-Host "   (use -FullDownload para baixar ~147 MB e validar SHA)"
}

Write-Host ""
Write-Host "SUCESSO - manifesto OK" -ForegroundColor Green
Write-Host "Clientes v1.2.0+: aviso no PC + download GitHub."
Write-Host "Clientes legados: installer\update-legacy.ps1 como admin."
