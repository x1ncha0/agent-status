param(
    [switch]$Apply,
    [string]$DataDir = "$env:LOCALAPPDATA\AgentStatus",
    [string]$ClaudeHome = "$env:USERPROFILE\.claude",
    [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { "$env:USERPROFILE\.codex" })
)
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $DataDir 'Write-AgentEvent.ps1'
$common = @('SessionStart','SessionEnd','UserPromptSubmit','PreToolUse','PermissionRequest','PostToolUse','PreCompact','PostCompact','Stop')
$plans = @()
foreach ($agent in @('claude','codex')) {
    $target = if ($agent -eq 'claude') { Join-Path $ClaudeHome 'settings.json' } else { Join-Path $CodexHome 'hooks.json' }
    $settings = if (Test-Path -LiteralPath $target) { Get-Content -LiteralPath $target -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
    if (-not $settings.PSObject.Properties['hooks']) { $settings | Add-Member hooks ([pscustomobject]@{}) }
    $events = $common + $(if ($agent -eq 'claude') { @('PostToolUseFailure','StopFailure','Notification','Elicitation','ElicitationResult') } else { @('Interrupt') })
    $command = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File "' + $scriptPath + '" -Agent ' + $agent + ' -DataDir "' + $DataDir + '"'
    foreach ($eventName in $events) {
        $groups = @()
        if ($settings.hooks.PSObject.Properties[$eventName]) {
            foreach ($group in $settings.hooks.$eventName) {
                $remaining = @($group.hooks | Where-Object { $_.command -ne $command })
                if ($remaining.Count) { $group.hooks = $remaining; $groups += $group }
            }
        }
        $groups += @{ hooks = @(@{ type = 'command'; command = $command; timeout = 3 }) }
        $settings.hooks | Add-Member -NotePropertyName $eventName -NotePropertyValue $groups -Force
    }
    $plans += @{ Target = $target; Content = ($settings | ConvertTo-Json -Depth 100) }
}
if (-not $Apply) {
    foreach ($plan in $plans) { Write-Output $plan.Target; Write-Output $plan.Content }
    Write-Output 'Preview only. Run again with -Apply to install; then review Codex /hooks.'
    exit 0
}
[IO.Directory]::CreateDirectory($DataDir) | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Write-AgentEvent.ps1') -Destination $scriptPath -Force
foreach ($plan in $plans) {
    [IO.Directory]::CreateDirectory((Split-Path $plan.Target)) | Out-Null
    if (Test-Path -LiteralPath $plan.Target) { Copy-Item -LiteralPath $plan.Target -Destination ($plan.Target + '.agent-status-' + [Guid]::NewGuid().ToString() + '.bak') }
    [IO.File]::WriteAllText($plan.Target, $plan.Content, [Text.UTF8Encoding]::new($false))
    Write-Output ('Updated: ' + $plan.Target)
}
Write-Output 'Restart CLI sessions. In Codex, use /hooks to review and trust the hooks.'
