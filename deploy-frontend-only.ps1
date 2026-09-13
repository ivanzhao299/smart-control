# Deploy frontend only to GK9000
$ErrorActionPreference = "Stop"
Set-Location "D:\smart-control"

Write-Host "=== 1. Git pull ===" -ForegroundColor Cyan
git pull origin main

Write-Host "=== 2. Build frontend ===" -ForegroundColor Cyan
Set-Location "D:\smart-control\frontend"
npm run build

Write-Host "=== 3. Restart frontend PM2 ===" -ForegroundColor Cyan
pm2 restart smart-control-frontend

Write-Host "=== 4. Verify status ===" -ForegroundColor Cyan
pm2 status

Write-Host "=== Frontend deploy complete ===" -ForegroundColor Green
