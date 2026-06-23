<#
  OneDesk Agent - desinstalador. Execute como ADMINISTRADOR.
#>
$ErrorActionPreference = "SilentlyContinue"

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$p = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Execute como Administrador." -ForegroundColor Red; exit 1
}

Write-Host "==> Parando agente..." -ForegroundColor Cyan
Get-Process -Name "OneDeskAgent" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "==> Removendo auto-start..." -ForegroundColor Cyan
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "OneDeskAgent" -ErrorAction SilentlyContinue
schtasks /Delete /TN "OneDeskAgent" /F 2>$null | Out-Null

Write-Host "==> Removendo arquivos..." -ForegroundColor Cyan
Remove-Item -Recurse -Force (Join-Path $env:ProgramFiles "OneDesk") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $env:ProgramData "OneDesk") -ErrorAction SilentlyContinue

Write-Host "OneDesk Agent removido." -ForegroundColor Green
