# Deploy backend only - restartHlsStream fix
$ErrorActionPreference = "Continue"
Set-Location "D:\smart-control"

Write-Host "=== 1. Git pull ===" -ForegroundColor Cyan
git pull origin main

Write-Host "=== 2. Build backend ===" -ForegroundColor Cyan
Set-Location "D:\smart-control\backend"
npm run build 2>&1 | Select-Object -Last 3

Write-Host "=== 3. Kill all FFmpeg processes (will restart with new params) ===" -ForegroundColor Cyan
Get-Process -Name ffmpeg -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "FFmpeg processes killed"

Write-Host "=== 4. Restart backend PM2 ===" -ForegroundColor Cyan
pm2 restart smart-control-backend

Write-Host "=== 5. Verify status ===" -ForegroundColor Cyan
pm2 status

Write-Host "=== Backend deploy complete ===" -ForegroundColor Green
Write-Host "FFmpeg will restart with optimized params when HLS requests come in"
