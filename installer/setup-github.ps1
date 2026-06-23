<#
  Configura GitHub: autenticacao, repositorio, secret DATABASE_URL, tag inicial.
  Execute na raiz do projeto apos git commit.

  Uso: powershell -ExecutionPolicy Bypass -File installer\setup-github.ps1
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$gh = Join-Path $root "tools\gh\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }

Set-Location $root

Write-Host ""
Write-Host "  OneDesk - Setup GitHub Releases" -ForegroundColor Green
Write-Host ""

Write-Host "==> 1. Autenticacao GitHub (abrira o navegador)" -ForegroundColor Cyan
& $gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
  & $gh auth login -h github.com -p https -w
}

$user = (& $gh api user -q .login).Trim()
$repoName = "o1nedesk"
$fullRepo = "$user/$repoName"
Write-Host "   conta: $user" -ForegroundColor DarkGray

Write-Host ""
Write-Host "==> 2. Criar repositorio $fullRepo" -ForegroundColor Cyan
$exists = & $gh repo view $fullRepo 2>$null
if ($LASTEXITCODE -ne 0) {
  & $gh repo create $repoName --private --source=. --remote=origin --description "OneDesk - suporte remoto Windows" --push
} else {
  Write-Host "   repo ja existe" -ForegroundColor DarkGray
  git remote get-url origin 2>$null
  if ($LASTEXITCODE -ne 0) { git remote add origin "https://github.com/$fullRepo.git" }
  git push -u origin HEAD
}

Write-Host ""
Write-Host "==> 3. Secret DATABASE_URL (GitHub Actions)" -ForegroundColor Cyan
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) { throw "Arquivo .env nao encontrado na raiz" }
$dbLine = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $dbLine) { throw "DATABASE_URL nao encontrado em .env" }
$dbUrl = ($dbLine -replace '^DATABASE_URL=', '' -replace '"', '').Trim()
& $gh secret set DATABASE_URL --body $dbUrl --repo $fullRepo
Write-Host "   secret DATABASE_URL configurado" -ForegroundColor Green

Write-Host ""
Write-Host "==> 4. Variavel GITHUB_RELEASE_REPO (local + Vercel)" -ForegroundColor Cyan
Write-Host "   Adicione no Vercel (dashboard): GITHUB_RELEASE_REPO=$fullRepo" -ForegroundColor Yellow
if (-not (Select-String -Path $envFile -Pattern '^GITHUB_RELEASE_REPO=' -Quiet)) {
  Add-Content $envFile "`nGITHUB_RELEASE_REPO=$fullRepo"
}

Write-Host ""
Write-Host "Pronto. Para publicar uma versao:" -ForegroundColor Green
Write-Host "  git tag v1.2.1"
Write-Host "  git push origin v1.2.1"
Write-Host ""
Write-Host "Ou localmente: installer\publish-release.ps1 -Version 1.2.1 -GitHubRepo $fullRepo"
