# Office network + firewall setup for Motonorte Payroll (docs/runbook-office.md §1 row 6 and §5).
# Right-click this file → "Run with PowerShell". It asks for administrator rights (click Yes), applies the settings,
# shows the result and waits for Enter.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}
$ErrorActionPreference = "Continue"
Write-Host "1/3  Office network (Ethernet) -> Private" -ForegroundColor Cyan
Set-NetConnectionProfile -InterfaceAlias Ethernet -NetworkCategory Private

Write-Host "2/3  Docker Desktop's own firewall rules -> Private networks only" -ForegroundColor Cyan
Get-NetFirewallApplicationFilter -Program "*com.docker.backend.exe" | Get-NetFirewallRule | Set-NetFirewallRule -Profile Private

Write-Host "3/3  Allow web ports 80/443 from the office network" -ForegroundColor Cyan
if (-not (Get-NetFirewallRule -DisplayName "Motonorte Payroll (office)" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "Motonorte Payroll (office)" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Profile Private -Action Allow | Out-Null
}

Write-Host ""
Write-Host "Result:" -ForegroundColor Green
"  Network:      " + (Get-NetConnectionProfile -InterfaceAlias Ethernet).NetworkCategory
"  Office rule:  " + ((Get-NetFirewallRule -DisplayName "Motonorte Payroll (office)" | ForEach-Object { "enabled=$($_.Enabled) profile=$($_.Profile)" }) -join "; ")
"  Docker rules: " + ((Get-NetFirewallApplicationFilter -Program "*com.docker.backend.exe" | Get-NetFirewallRule | ForEach-Object { "$($_.Profile)" }) -join ", ")
Write-Host ""
Read-Host "Done. Press Enter to close"
