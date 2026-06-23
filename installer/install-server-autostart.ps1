<#
  Faz o OneDesk Server (hub + tunel + heartbeat) iniciar AUTOMATICAMENTE no logon,
  SEM precisar de administrador: coloca um lancador oculto na pasta Inicializar.
  Execute uma vez nesta maquina (a host).
#>
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "onedesk-server.ps1"
if (-not (Test-Path $script)) { throw "onedesk-server.ps1 nao encontrado" }

$startup = [Environment]::GetFolderPath("Startup")
$vbs = Join-Path $startup "OneDeskServer.vbs"

# .vbs lanca o PowerShell totalmente oculto (sem piscar console)
$content = @"
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$script""", 0, False
"@
Set-Content -Path $vbs -Value $content -Encoding ASCII

Write-Host "==> Auto-start instalado: $vbs" -ForegroundColor Green

# Inicia agora tambem
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbs`""
Write-Host "==> OneDesk Server iniciado. O dashboard deve mostrar 'Servidor: online' em ~30s." -ForegroundColor Green
