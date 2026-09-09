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
    # Identify the actual CLI ancestor, not this short-lived hook process.
    # Creation time prevents restoring stale state after Windows reuses a PID.
    try {
        $ancestorId = $PID
        for ($depth = 0; $depth -lt 8 -and $ancestorId -gt 0; $depth++) {
            $ancestor = Get-CimInstance Win32_Process -Filter "ProcessId = $ancestorId" -ErrorAction Stop
            if (-not $ancestor) { break }
            if ($ancestor.Name -ieq "$Agent.exe" -or ($Agent -eq 'claude' -and $ancestor.Name -ieq 'node.exe' -and $ancestor.CommandLine -match 'claude-code')) {
                $record.owner_pid = [int]$ancestor.ProcessId
                $record.owner_started_at = ([DateTimeOffset]$ancestor.CreationDate.ToUniversalTime()).ToUnixTimeMilliseconds()
                break
            }
            $ancestorId = [int]$ancestor.ParentProcessId
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
