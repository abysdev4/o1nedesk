<#
  Sobe o HUB local + tunel Cloudflare publico (wss) e mostra a URL publica.
  Mantenha esta janela aberta enquanto quiser o acesso remoto publico ativo.

  ATENCAO: o tunel "quick" gera uma URL NOVA a cada execucao. Se a URL mudar,
  e preciso atualizar:
    - agent/Config.cs (HubWs)  -> reconstruir o agente (installer/build-agent.ps1)
    - env NEXT_PUBLIC_HUB_WS na Vercel -> redeploy (vercel --prod)
  Para uma URL fixa, use um tunel nomeado (conta Cloudflare free + dominio).
#>
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> Iniciando hub (porta 4000)..." -ForegroundColor Cyan
$hub = Start-Process -FilePath "npm" -ArgumentList "run","start:hub" -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 5

Write-Host "==> Abrindo tunel Cloudflare publico..." -ForegroundColor Cyan
& "$root\tools\cloudflared.exe" tunnel --url http://localhost:4000
