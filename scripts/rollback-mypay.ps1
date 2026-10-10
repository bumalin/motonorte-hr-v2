param([switch]$ValidateOnly)
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$backup=Join-Path $project 'backups\before-mypay-20261010-143852'
$expected='sha256:2075a7357286524d7c73ebdfa646dcbcd6fcc63eac1a45c8e0d088f4b47b085c'
foreach($line in Get-Content -LiteralPath (Join-Path $backup 'SHA256SUMS.txt')){
 $parts=$line -split '  ',2
 if((Get-FileHash -LiteralPath (Join-Path $backup $parts[1]) -Algorithm SHA256).Hash -ne $parts[0]){throw 'Backup archive checksum mismatch'}
}
if((Get-Content -LiteralPath (Join-Path $backup 'app-image-id.txt')).Trim() -ne $expected){throw 'Unexpected rollback image'}
if($ValidateOnly){Write-Output 'My Pay rollback archives verified. No services changed.';exit}
$docker=Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
if(-not(Test-Path -LiteralPath $docker)){$docker=(Get-Command docker -ErrorAction Stop).Source}
& $docker image load --input (Join-Path $backup 'app-image.tar')
if($LASTEXITCODE -ne 0){throw 'Image restore failed'}
& $docker image tag $expected 'motonorte-office-app:before-mypay-20261010'
$override=Join-Path $backup 'rollback-mypay.compose.yml'
@"
services:
  app:
    image: motonorte-office-app:before-mypay-20261010
"@ | Set-Content -LiteralPath $override -Encoding utf8
Push-Location -LiteralPath $project
try{
 & $docker compose -p motonorte-office -f docker-compose.yml -f $override up -d --no-deps --no-build app
 if($LASTEXITCODE -ne 0){throw 'App rollback failed'}
}finally{Pop-Location}
Write-Output 'Previous UI restored. Live database, credentials, portal records and volume retained. Employee portal routes require the new image; source rebuild rolls forward.'
