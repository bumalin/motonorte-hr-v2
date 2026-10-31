param([switch]$ValidateOnly)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$backup=Join-Path $root 'backups\before-redesign-20261010-133051'
foreach($line in Get-Content -LiteralPath (Join-Path $backup 'SHA256SUMS.txt')){
 if($line -notmatch '^([A-Fa-f0-9]{64})  ([^\\/]+)$'){throw 'Invalid backup manifest'}
 $expected=$Matches[1];$file=Join-Path $backup $Matches[2]
 if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $expected){throw 'Backup checksum mismatch'}
}
$image=(Get-Content -LiteralPath (Join-Path $backup 'app-image-id.txt') -Raw).Trim()
if($image -notmatch '^sha256:[a-f0-9]{64}$'){throw 'Invalid image ID'}
if($ValidateOnly){Write-Output 'Rollback archive verified; no service changes.';exit 0}
$docker=Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
& $docker image load -i (Join-Path $backup 'app-image.tar')
if($LASTEXITCODE){throw 'Image load failed'}
$override=Join-Path $backup 'rollback-attendance.compose.yml'
@"
services:
  app:
    image: $image
"@ | Set-Content -Encoding utf8 -LiteralPath $override
& $docker compose -p motonorte-office -f (Join-Path $root 'docker-compose.yml') -f $override up -d --no-deps --no-build app
if($LASTEXITCODE){throw 'App rollback failed'}
Write-Output 'Previous app image restored. Live database and credentials retained. Migration 015 protections and archived versions remain; old UI does not display archived versions. Source stays updated. No database rollback was performed.'
