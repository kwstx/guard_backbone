# Guard Backbone Desktop Build Script (Windows)
# This script bundles the Python logic and the HTML dashboard into a single .exe

Write-Host "Installing build dependencies..." -ForegroundColor Cyan
pip install pywebview pyinstaller

Write-Host "Cleaning previous builds..." -ForegroundColor Yellow
Remove-Item -Path "dist", "build" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Bundling Guard Backbone into a standalone executable..." -ForegroundColor Green
pyinstaller --noconfirm --onefile --windowed `
    --add-data "dashboard.html;." `
    --name "GuardBackbone" `
    --icon "NONE" `
    run_gui.py

Write-Host "`nSuccessfully built Guard Backbone GUI!" -ForegroundColor Green
Write-Host "The executable is located in: $(Get-Location)\dist\GuardBackbone.exe" -ForegroundColor Cyan
