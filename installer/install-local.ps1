<#
  OneDesk Agent - instalador local (PowerShell)
  Instala o agente, grava config, configura auto-start com o Windows e inicia.
  Execute como ADMINISTRADOR.

  Uso:
    powershell -ExecutionPolicy Bypass -File install-local.ps1 -HubWs "ws://SEU_SERVIDOR:4000" -EnrollToken "TOKEN"
#>
param(
    [string]$HubWs = "ws://localhost:4000",
    [string]$EnrollToken = "177d4735c4e5fe67afeb5922752a878e",
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Execute este script como Administrador."
    }
}
Assert-Admin

$root = Split-Path -Parent $PSScriptRoot
$srcExe = Join-Path $root "agent\publish\OneDeskAgent.exe"
if (-not (Test-Path $srcExe)) {
    Write-Host "Agente nao compilado. Rodando build..." -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot "build-agent.ps1")
}

$installDir = Join-Path $env:ProgramFiles "OneDesk"
$dataDir = Join-Path $env:ProgramData "OneDesk"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

# para instancia em execucao
Get-Process -Name "OneDeskAgent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

Write-Host "==> Copiando agente para $installDir" -ForegroundColor Cyan
Copy-Item $srcExe (Join-Path $installDir "OneDeskAgent.exe") -Force

# config.json
$config = @{
  HubWs = $HubWs
  EnrollToken = $EnrollToken
  DiscoveryUrl = "https://onedesk-gamma.vercel.app/api/hub/status"
} | ConvertTo-Json
Set-Content -Path (Join-Path $dataDir "config.json") -Value $config -Encoding utf8
Write-Host "==> Config gravada: HubWs=$HubWs" -ForegroundColor Cyan

$exePath = Join-Path $installDir "OneDeskAgent.exe"

# ---- Auto-start 1: chave Run (HKLM) - sobe para qualquer usuario no logon ----
$runKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $runKey -Name "OneDeskAgent" -Value "`"$exePath`"" -Force
Write-Host "==> Auto-start (Run) configurado" -ForegroundColor Cyan

# ---- Auto-start 2: Tarefa Agendada no logon (robustez / 'nunca perder acesso') ----
$taskName = "OneDeskAgent"
schtasks /Query /TN $taskName 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { schtasks /Delete /TN $taskName /F | Out-Null }

$action = New-ScheduledTaskAction -Execute $exePath
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 9999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -GroupId "S-1-5-32-545" -RunLevel Limited  # Users
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "==> Auto-start (Tarefa Agendada no logon) configurado" -ForegroundColor Cyan

if (-not $NoStart) {
    Write-Host "==> Iniciando agente..." -ForegroundColor Cyan
    Start-Process -FilePath $exePath
}

Write-Host ""
Write-Host "OneDesk Agent instalado com sucesso." -ForegroundColor Green
Write-Host "  - Executavel: $exePath"
Write-Host "  - Dados:      $dataDir"
Write-Host "  - Sobe automaticamente com o Windows (Run + Tarefa Agendada)."
Write-Host "  - Para desinstalar: uninstall.ps1"
