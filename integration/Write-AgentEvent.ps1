param(
    [Parameter(Mandatory=$true)][ValidateSet('claude','codex')][string]$Agent,
    [string]$DataDir = "$env:LOCALAPPDATA\AgentStatus"
)
$ErrorActionPreference = 'Stop'
try {
    $eventData = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if (-not $eventData.session_id -or -not $eventData.hook_event_name) { exit 0 }
    $record = @{
        agent = $Agent
        session_id = [string]$eventData.session_id
        hook_event_name = [string]$eventData.hook_event_name
        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    foreach ($field in @('tool_name','notification_type','source')) {
        if ($null -ne $eventData.$field) { $record[$field] = [string]$eventData.$field }
    }
    $eventDir = Join-Path $DataDir "events\$Agent"
    [IO.Directory]::CreateDirectory($eventDir) | Out-Null
    $name = [Guid]::NewGuid().ToString()
    $temporary = Join-Path $eventDir "$name.tmp"
    $destination = Join-Path $eventDir "$name.json"
    [IO.File]::WriteAllText($temporary, ($record | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    [IO.File]::Move($temporary, $destination)
} catch {
    # Monitoring không được chặn agent hoặc thay đổi approval decision.
}
exit 0
