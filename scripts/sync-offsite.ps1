# Copies new encrypted backups (*.age) from the install's offsite\ folder into a cloud-synced folder.
# Why: files written by Docker into Google Drive's virtual G: drive are invisible to Windows and never upload
# (verified 2026-09-27), so the backup container writes locally and Windows copies them here.
# Run daily after the backup time (Task Scheduler) — see docs/runbook-office.md §6.
param(
  [string]$Source = "$PSScriptRoot\..\offsite",
  [string]$Target = "G:\My Drive\Backup\MotonortePayroll"
)
$ErrorActionPreference = "Stop"
$log = Join-Path $Source "sync.log"
if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Force $Target | Out-Null }
# /XO: never overwrite a newer copy; no /PURGE: the cloud keeps everything ever copied (files are small, encrypted)
robocopy $Source $Target *.age /XO /R:3 /W:10 /NP /NJH /NJS | Out-Null
$code = $LASTEXITCODE
$newest = Get-ChildItem $Target -Filter *.age | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
if ($code -ge 8) {
  "$stamp FAILED robocopy exit $code" | Add-Content $log
  exit 1
}
"$stamp ok (robocopy $code); newest in cloud folder: $($newest.Name)" | Add-Content $log
if (-not $newest -or $newest.LastWriteTime -lt (Get-Date).AddHours(-26)) {
  "$stamp WARNING: no encrypted backup newer than 26 h in $Target" | Add-Content $log
  exit 2
}
exit 0
