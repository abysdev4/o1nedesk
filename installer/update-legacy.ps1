<#
  Atualiza agentes legados para a versao mais recente (download via GitHub Releases).
  Execute como ADMINISTRADOR na maquina cliente.

  Uso: powershell -ExecutionPolicy Bypass -File installer\update-legacy.ps1
#>
$ErrorActionPreference = "Stop"
function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute como Administrador."
  }
}
Assert-Admin

Write-Host "==> Consultando manifesto..." -ForegroundColor Cyan
$m = Invoke-RestMethod "https://onedesk-gamma.vercel.app/api/agent/version"
$url = if ($m.downloadUrl) { $m.downloadUrl } else {
  $status = Invoke-RestMethod "https://onedesk-gamma.vercel.app/api/hub/status"
  "$($status.url -replace '^wss://','https://')/download/agent"
}
$sha = $m.sha256
Write-Host "   versao: v$($m.version)"
Write-Host "   url:    $url"

$tmp = Join-Path $env:TEMP "OneDeskAgent-$($m.version).exe"
Write-Host "==> Baixando (~147 MB, pode demorar)..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing

$got = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
if ($sha -and $got -ne $sha.ToLower()) { throw "SHA invalido" }

Write-Host "==> Instalando..." -ForegroundColor Cyan
Get-Process OneDeskAgent -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Start-Process -FilePath $tmp -ArgumentList "--install" -Verb RunAs -Wait
Write-Host "OneDesk Agent atualizado para v$($m.version)." -ForegroundColor Green
Write-Host "Proximas atualizacoes: aviso no PC + download automatico do GitHub." -ForegroundColor DarkGray
