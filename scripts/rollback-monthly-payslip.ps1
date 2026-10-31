param([switch]$ValidateOnly)
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$backup=Join-Path $project 'backups\before-monthly-payslip-20261010-163946'
foreach($entry in Get-Content -LiteralPath (Join-Path $backup 'SHA256SUMS.txt')){
 $parts=$entry -split '  ',2
 if((Get-FileHash -LiteralPath (Join-Path $backup $parts[1])).Hash -ne $parts[0]){throw 'Backup checksum mismatch'}
}
$expected=(Get-Content -LiteralPath (Join-Path $backup 'app-image-id.txt')).Trim()
if($ValidateOnly){Write-Output 'Monthly payslip rollback archives verified. No services changed.';exit}
$docker=Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
& $docker image load --input (Join-Path $backup 'app-image.tar')
if($LASTEXITCODE){throw 'Image restore failed'}
& $docker image tag $expected motonorte-office-app:before-monthly-payslip
$override=Join-Path $backup 'rollback.compose.yml'
@"
services:
  app:
    image: motonorte-office-app:before-monthly-payslip
"@ | Set-Content -LiteralPath $override -Encoding utf8
Push-Location -LiteralPath $project
try{
 & $docker compose -p motonorte-office -f docker-compose.yml -f $override up -d --no-deps --no-build app
 if($LASTEXITCODE){throw 'Rollback failed'}
}finally{Pop-Location}
Write-Output 'Previous monthly payslip behavior restored. Live database, credentials and employee portal records retained; source rebuild rolls forward.'
