# Deploy smart-control to GK9000
$ErrorActionPreference = "Stop"
Set-Location "D:\smart-control"

Write-Host "=== 1. Git pull ===" -ForegroundColor Cyan
git pull origin main

Write-Host "=== 2. Build backend (clean dist first) ===" -ForegroundColor Cyan
Set-Location "D:\smart-control\backend"
if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }
npm run build

Write-Host "=== 3. Build frontend ===" -ForegroundColor Cyan
Set-Location "D:\smart-control\frontend"
npm run build

Write-Host "=== 4. Restart PM2 ===" -ForegroundColor Cyan
pm2 restart smart-control-backend
pm2 restart smart-control-frontend

Write-Host "=== 5. Verify status ===" -ForegroundColor Cyan
pm2 status

Write-Host "=== Deploy complete ===" -ForegroundColor Green
