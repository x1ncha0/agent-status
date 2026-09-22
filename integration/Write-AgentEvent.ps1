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
    foreach ($field in @('tool_name','tool_use_id','notification_type','source')) {
        if ($null -ne $eventData.$field) { $record[$field] = [string]$eventData.$field }
    }
    # A native process snapshot avoids repeated WMI queries on every hook.
    # Load bytes so a running hook does not lock the DLL during an update.
    try {
        $null = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes((Join-Path $DataDir 'ProcessOwner.dll')))
        $owner = [AgentStatus.ProcessOwner]::Find($Agent, $PID)
        if ($owner) {
            $record.owner_pid = [int]$owner[0]
            $record.owner_started_at = [long]$owner[1]
        }
    } catch { # Fresh events still work when process inspection is unavailable.
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
