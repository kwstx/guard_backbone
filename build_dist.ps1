# Guard Backbone Desktop Distribition Script (Windows)
# This script prepares a portable folder for the GUI.

Write-Host "Preparing Guard Backbone distributable package..." -ForegroundColor Cyan

$distFolder = "dist_portable"
if (Test-Path $distFolder) { Remove-Item $distFolder -Recurse -Force }
New-Item -ItemType Directory -Path $distFolder

Write-Host "Copying assets..." -ForegroundColor Yellow
Copy-Item "dashboard.html" $distFolder
Copy-Item "launch_gui.ps1" $distFolder
Copy-Item "Start_Dashboard.bat" $distFolder

Write-Host "`nSuccessfully created distributable package!" -ForegroundColor Green
Write-Host "The package is located in: $(Join-Path (Get-Location) $distFolder)" -ForegroundColor Cyan
Write-Host "Simply ZIP this folder and send it to users. They just need to double-click 'Start_Dashboard.bat'." -ForegroundColor White
