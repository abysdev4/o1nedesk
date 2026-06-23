<#
  Publica release do agente via GitHub (recomendado) ou localmente.

  FLUXO RECOMENDADO (CI automatico):
    git tag v1.2.1
    git push origin v1.2.1
    -> GitHub Actions compila, cria Release e atualiza manifesto no Neon

  FLUXO LOCAL (fallback):
    installer\publish-release.ps1 -Version 1.2.1 -Notes "..."

  Requer secret DATABASE_URL no GitHub para o workflow.
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = "Atualizacao do agente",
  [string]$GitHubRepo = "abysdev4/o1nedesk"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$gh = Join-Path $root "tools\gh\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }

Write-Host "==> Ajustando versao para $Version" -ForegroundColor Cyan
$um = Join-Path $root "agent\UpdateManager.cs"
(Get-Content $um -Raw) -replace 'CurrentVersion = "[^"]*"', "CurrentVersion = `"$Version`"" |
  Set-Content $um -Encoding utf8

Write-Host "==> Parando agente local (se rodando) e compilando..." -ForegroundColor Cyan
Get-Process -Name OneDeskAgent -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
& (Join-Path $PSScriptRoot "build-agent.ps1")

Copy-Item (Join-Path $root "agent\publish\OneDeskAgent.exe") (Join-Path $root "dist\OneDeskAgent-Setup.exe") -Force
$sha = (Get-FileHash (Join-Path $root "dist\OneDeskAgent-Setup.exe") -Algorithm SHA256).Hash.ToLower()
Write-Host "==> sha256: $sha" -ForegroundColor Cyan

$downloadUrl = "https://github.com/$GitHubRepo/releases/download/v$Version/OneDeskAgent-Setup.exe"

Write-Host "==> Criando GitHub Release v$Version..." -ForegroundColor Cyan
$asset = Join-Path $root "dist\OneDeskAgent-Setup.exe"
& $gh release create "v$Version" $asset `
  --repo $GitHubRepo `
  --title "OneDesk Agent $Version" `
  --notes $Notes
if ($LASTEXITCODE -ne 0) {
  Write-Host "AVISO: gh release falhou (repo existe? gh auth login?). Continuando manifesto..." -ForegroundColor Yellow
}

Write-Host "==> Atualizando manifesto no banco..." -ForegroundColor Cyan
Push-Location $root
try {
  npm -w "@onedesk/db" run release -- $Version $sha $downloadUrl $Notes
} finally { Pop-Location }

Write-Host ""
Write-Host "Release v$Version publicado." -ForegroundColor Green
Write-Host " downloadUrl: $downloadUrl"
Write-Host " Clientes v1.2.0+ baixam do GitHub; hub /download/agent e fallback."
