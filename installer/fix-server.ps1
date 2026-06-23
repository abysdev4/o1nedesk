<#
  CONSERTO RAPIDO: mata o tunel morto e o hub antigo (inclusive os iniciados como admin),
  liberando a porta 4000. Depois disso, rode o OneDesk-Servidor.bat NORMALMENTE (sem admin).

  >>> Execute este arquivo COMO ADMINISTRADOR (botao direito -> Executar como administrador). <<<
#>
$ErrorActionPreference = "SilentlyContinue"

Write-Host "==> Encerrando cloudflared (tunel)..." -ForegroundColor Cyan
taskkill /IM cloudflared.exe /F 2>$null | Out-Null

Write-Host "==> Encerrando o hub (node na porta 4000)..." -ForegroundColor Cyan
$conns = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) { taskkill /PID $c.OwningProcess /F 2>$null | Out-Null }

Start-Sleep -Seconds 2
$cf = (Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Measure-Object).Count
$hub = (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count

Write-Host ""
if ($cf -eq 0 -and $hub -eq 0) {
  Write-Host "OK — orfaos encerrados (cloudflared=0, porta 4000 livre)." -ForegroundColor Green
  Write-Host "Agora rode o OneDesk-Servidor.bat (duplo-clique, SEM admin) e deixe a janela aberta." -ForegroundColor Green
} else {
  Write-Host "Ainda restam processos (cloudflared=$cf, hub=$hub). Se persistir, reinicie o PC." -ForegroundColor Yellow
}
Write-Host ""
pause
