<#
  OneDesk Servidor (host): sobe o HUB + tunel Cloudflare e mantem a URL publica
  registrada na Vercel (para os agentes/dashboard descobrirem sozinhos).
  Mantenha a janela ABERTA. Feche para desligar o acesso remoto.
#>
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$registerUrl = "https://onedesk-gamma.vercel.app/api/hub/register"
$agentBinary = Join-Path $root "dist\OneDeskAgent-Setup.exe"

$secret = ""
if (Test-Path "$root\.env") {
  $raw = (Get-Content "$root\.env" | Where-Object { $_ -match '^HUB_INTERNAL_TOKEN=' } | Select-Object -First 1)
  if ($raw) { $secret = ($raw -replace '^HUB_INTERNAL_TOKEN=', '' -replace '"', '').Trim() }
}

$cfo = Join-Path $env:TEMP "onedesk-cf-out.log"
$cfe = Join-Path $env:TEMP "onedesk-cf-err.log"

function Test-LocalHub {
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:4000/health" -UseBasicParsing -TimeoutSec 5
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Wait-LocalHub([int]$seconds = 45) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalHub) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Stop-Hub {
  $c = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    Write-Host "[hub] parando PID $($c.OwningProcess)..." -ForegroundColor Yellow
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

function Start-Hub {
  if (-not (Test-Path $agentBinary)) {
    Write-Host "[hub] AVISO: binario nao encontrado em $agentBinary" -ForegroundColor Red
  }
  Write-Host "[hub] iniciando na porta 4000..." -ForegroundColor Cyan
  $cmd = "set `"AGENT_BINARY_PATH=$agentBinary`" && npm run start:hub"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -WorkingDirectory $root -WindowStyle Hidden
  if (Wait-LocalHub 45) {
    Write-Host "[hub] pronto (health OK)" -ForegroundColor Green
    return $true
  }
  Write-Host "[hub] ERRO: nao respondeu em /health" -ForegroundColor Red
  return $false
}

function Stop-Tunnel {
  Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Remove-Item $cfo, $cfe -Force -ErrorAction SilentlyContinue
}

function Get-TunnelUrlFromLogs {
  $m = Select-String -Path @($cfe, $cfo) -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($m) { return $m.Matches[0].Value }
  return $null
}

function Wait-TunnelUrl([int]$seconds = 60) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    $u = Get-TunnelUrlFromLogs
    if ($u) { return $u }
    Start-Sleep -Seconds 2
  }
  return $null
}

function Start-Tunnel {
  Stop-Tunnel
  Write-Host "[tunel] abrindo Cloudflare -> localhost:4000 ..." -ForegroundColor Cyan
  Start-Process -FilePath "$root\tools\cloudflared.exe" `
    -ArgumentList "tunnel", "--url", "http://127.0.0.1:4000", "--no-autoupdate" `
    -RedirectStandardOutput $cfo -RedirectStandardError $cfe -WindowStyle Hidden
  $url = Wait-TunnelUrl 60
  if (-not $url) {
    Write-Host "[tunel] ERRO: URL nao apareceu nos logs em 60s" -ForegroundColor Red
    return $null
  }
  Write-Host "[tunel] URL obtida: $url" -ForegroundColor Cyan
  # Cloudflare leva alguns segundos para rotear trafego externo
  Start-Sleep -Seconds 6
  return $url
}

function Test-TunnelPublic($url) {
  if (-not $url) { return $false }
  $target = "$url/health"
  # curl.exe e mais confiavel que Invoke-WebRequest com trycloudflare.com no Windows
  try {
    $code = & curl.exe -s -o NUL -w "%{http_code}" --max-time 12 $target 2>$null
    if ($code -eq "200") { return $true }
  } catch {}
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $r = Invoke-WebRequest $target -UseBasicParsing -TimeoutSec 12
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Wait-TunnelPublic($url, [int]$seconds = 45) {
  $deadline = (Get-Date).AddSeconds($seconds)
  $n = 0
  while ((Get-Date) -lt $deadline) {
    $n++
    if (Test-TunnelPublic $url) { return $true }
    if ($n -le 5 -or ($n % 4) -eq 0) {
      Write-Host "[tunel] aguardando rota publica ($n)..." -ForegroundColor DarkGray
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Register-HubUrl($wss) {
  try {
    $body = @{ url = $wss; secret = $secret } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $registerUrl -Method Post -ContentType "application/json" -Body $body -TimeoutSec 10 | Out-Null
    return $true
  } catch { return $false }
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "   OneDesk Servidor" -ForegroundColor Green
Write-Host "   Mantenha esta janela ABERTA." -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""

Stop-Tunnel
Stop-Hub

if (-not (Start-Hub)) {
  Write-Host "Nao foi possivel iniciar o hub. Verifique npm/node e a porta 4000." -ForegroundColor Red
  Read-Host "Enter para sair"
  exit 1
}

$publicUrl = Start-Tunnel
if (-not $publicUrl) {
  Write-Host "Nao foi possivel abrir o tunel. Verifique tools\cloudflared.exe e internet." -ForegroundColor Red
  Read-Host "Enter para sair"
  exit 1
}

$publicOk = Wait-TunnelPublic $publicUrl 45
if (-not $publicOk) {
  Write-Host "[tunel] AVISO: rota publica ainda nao respondeu (hub local OK)" -ForegroundColor Yellow
  Write-Host "[tunel] registrando URL mesmo assim - Cloudflare pode levar mais alguns segundos" -ForegroundColor Yellow
}

$wss = $publicUrl -replace '^https://', 'wss://'
Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] ONLINE -> " + $wss) -ForegroundColor Green
if (Register-HubUrl $wss) {
  Write-Host "[registro] URL enviada para o dashboard" -ForegroundColor DarkGray
} else {
  Write-Host "[registro] AVISO: falha ao registrar na Vercel (sem internet?)" -ForegroundColor Yellow
}

$last = $wss
$fails = 0
while ($true) {
  if (-not (Test-LocalHub)) {
    Write-Host "[hub] caiu - reiniciando..." -ForegroundColor Yellow
    Stop-Hub
    if (-not (Start-Hub)) { Start-Sleep -Seconds 5; continue }
    Stop-Tunnel
    $publicUrl = Start-Tunnel
    if (-not $publicUrl) { Start-Sleep -Seconds 5; continue }
    Wait-TunnelPublic $publicUrl 30 | Out-Null
    $wss = $publicUrl -replace '^https://', 'wss://'
    Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] ONLINE -> " + $wss) -ForegroundColor Green
    Register-HubUrl $wss | Out-Null
    $last = $wss
    $fails = 0
    Start-Sleep -Seconds 8
    continue
  }

  $u = Get-TunnelUrlFromLogs
  $cfAlive = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
  if ($u -and $cfAlive) {
    $wss = $u -replace '^https://', 'wss://'
    if ($wss -ne $last) {
      Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] URL -> " + $wss) -ForegroundColor Green
      $last = $wss
    }
    Register-HubUrl $wss | Out-Null
    if (Test-TunnelPublic $u) {
      $fails = 0
    } else {
      $fails++
      if ($fails -ge 8) {
        Write-Host "[tunel] rota publica lenta ($fails) - reiniciando cloudflared..." -ForegroundColor Yellow
        Stop-Tunnel
        $publicUrl = Start-Tunnel
        if ($publicUrl) {
          Wait-TunnelPublic $publicUrl 20 | Out-Null
          $wss = $publicUrl -replace '^https://', 'wss://'
          Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] ONLINE -> " + $wss) -ForegroundColor Green
          Register-HubUrl $wss | Out-Null
          $last = $wss
        }
        $fails = 0
      }
    }
  } else {
    $fails++
    Write-Host ("[tunel] cloudflared sem URL ($fails/3) - reiniciando tunel...") -ForegroundColor Yellow
    if ($fails -ge 3) {
      Stop-Tunnel
      $publicUrl = Start-Tunnel
      if ($publicUrl) {
        Wait-TunnelPublic $publicUrl 20 | Out-Null
        $wss = $publicUrl -replace '^https://', 'wss://'
        Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] ONLINE -> " + $wss) -ForegroundColor Green
        Register-HubUrl $wss | Out-Null
        $last = $wss
      }
      $fails = 0
    }
  }
  Start-Sleep -Seconds 10
}
