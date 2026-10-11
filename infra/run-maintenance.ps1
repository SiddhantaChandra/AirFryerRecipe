param(
    [string]$ComposeFile = (Join-Path $PSScriptRoot '..\compose.yaml'),
    [string]$StatePath = (Join-Path $PSScriptRoot '..\maintenance-status.json')
)

$ErrorActionPreference = 'Stop'
$state = @{ started_at = [DateTime]::UtcNow.ToString('o'); refresh_exit = -1; expiry_exit = -1 }
try {
    & docker compose -f $ComposeFile exec -T web python manage.py refresh_youtube_metadata
    $state.refresh_exit = $LASTEXITCODE
} catch {
    Write-Error 'Refresh invocation failed; expiry will still be attempted.' -ErrorAction Continue
} finally {
    try {
        & docker compose -f $ComposeFile exec -T web python manage.py purge_expired_source_metadata
        $state.expiry_exit = $LASTEXITCODE
    } catch {
        Write-Error 'Expiry invocation failed; check Docker and task status.' -ErrorAction Continue
    }
    $state.finished_at = [DateTime]::UtcNow.ToString('o')
    $state | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
}
if ($state.refresh_exit -ne 0 -or $state.expiry_exit -ne 0) { exit 1 }
exit 0
