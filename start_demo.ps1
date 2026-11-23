# Launches GlanceDesk backend proxy, Vite WebView app, and official Even Hub Simulator
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Starting GlanceDesk Backend (:8787)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; npm run server"
Start-Sleep -Seconds 1
Write-Host "Starting GlanceDesk WebView (:5173)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; npm run dev"
Start-Sleep -Seconds 2
Write-Host "Launching Official Even Hub G2 Simulator..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; npm run sim"
Write-Host "Also open http://127.0.0.1:5173 in your browser if you want the 576x288 interactive gesture panel." -ForegroundColor Gray
