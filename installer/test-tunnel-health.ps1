# Teste rapido: compara Invoke-WebRequest vs curl no /health publico
$cfe = Join-Path $env:TEMP "onedesk-cf-err.log"
$cfo = Join-Path $env:TEMP "onedesk-cf-out.log"
$m = Select-String -Path @($cfe, $cfo) -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -Last 1
if (-not $m) { Write-Host "Sem URL nos logs. Rode OneDesk-Servidor.bat primeiro."; exit 1 }
$url = $m.Matches[0].Value
Write-Host "URL: $url"
Write-Host "Local hub:" (Invoke-WebRequest "http://127.0.0.1:4000/health" -UseBasicParsing -TimeoutSec 5).StatusCode
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $r = Invoke-WebRequest "$url/health" -UseBasicParsing -TimeoutSec 12
  Write-Host "IWR publico:" $r.StatusCode
} catch {
  Write-Host "IWR publico FALHOU:" $_.Exception.Message
}
$code = & curl.exe -s -o NUL -w "%{http_code}" --max-time 12 "$url/health"
Write-Host "curl publico:" $code
