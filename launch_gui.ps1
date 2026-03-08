# Guard Backbone GUI Launcher (Native Windows)
# This script launches the dashboard in Edge "App Mode" which looks like a standalone application.

$dashboardPath = Join-Path $PSScriptRoot "dashboard.html"

if (-not (Test-Path $dashboardPath)) {
    Write-Error "Could not find dashboard.html at $dashboardPath"
    exit 1
}

# Construct the file URL
$fileUrl = "file:///$($dashboardPath.Replace('\', '/'))"

Write-Host "Launching Guard Backbone Security Ledger..." -ForegroundColor Green

# Launch MS Edge in App Mode
# --app: Launches without tabs/address bar
# --window-size: Ideal starting dimensions
Start-Process "msedge.exe" -ArgumentList "--app=`"$fileUrl`"", "--window-size=1200,800", "--title=`"Guard Backbone | Security Ledger`""
