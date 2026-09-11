param(
    [switch]$Apply,
    [switch]$Check,
    [string]$DataDir = "$env:LOCALAPPDATA\AgentStatus",
    [string]$ClaudeHome = "$env:USERPROFILE\.claude",
    [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { "$env:USERPROFILE\.codex" })
)
$ErrorActionPreference = 'Stop'
if ($Apply -and $Check) { throw 'Use either -Apply or -Check.' }
$scriptPath = Join-Path $DataDir 'Write-AgentEvent.ps1'
$common = @('SessionStart','SessionEnd','UserPromptSubmit','PreToolUse','PermissionRequest','PostToolUse','PreCompact','PostCompact','Stop')
$plans = @()
$agents = @()
foreach ($agent in @('claude','codex')) {
    $target = if ($agent -eq 'claude') { Join-Path $ClaudeHome 'settings.json' } else { Join-Path $CodexHome 'hooks.json' }
    $settings = if (Test-Path -LiteralPath $target) { Get-Content -LiteralPath $target -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }
    if (-not $settings.PSObject.Properties['hooks']) { $settings | Add-Member hooks ([pscustomobject]@{}) }
    $events = $common + $(if ($agent -eq 'claude') { @('PostToolUseFailure','StopFailure','Notification','Elicitation','ElicitationResult') } else { @('Interrupt') })
    # WindowStyle acts on an inherited console too; never hide the caller's terminal.
    $command = 'powershell.exe -NoProfile -NonInteractive -File "' + $scriptPath + '" -Agent ' + $agent + ' -DataDir "' + $DataDir + '"'
    $configured = $true
    $hasLegacy = $false
    foreach ($eventName in $events) {
        $groups = @()
        $found = $false
        if ($settings.hooks.PSObject.Properties[$eventName]) {
            foreach ($group in $settings.hooks.$eventName) {
                foreach ($handler in $group.hooks) {
                    $isOwnHandler = $handler.command -match '(?i)Write-AgentEvent\.ps1' -and $handler.command -match ('(?i)-Agent\s+' + [regex]::Escape($agent) + '(?:\s|$)')
                    if ($isOwnHandler -and $handler.command -match '(?i)-WindowStyle\s+Hidden') { $hasLegacy = $true }
                    if ($handler.command -eq $command -and $handler.type -eq 'command' -and
                        (-not $group.matcher -or $group.matcher -eq '*')) { $found = $true }
                }
                $remaining = @($group.hooks | Where-Object {
                    $isOwnHandler = $_.command -match '(?i)Write-AgentEvent\.ps1' -and $_.command -match ('(?i)-Agent\s+' + [regex]::Escape($agent) + '(?:\s|$)')
                    -not $isOwnHandler
                })
                if ($remaining.Count) { $group.hooks = $remaining; $groups += $group }
            }
        }
        if (-not $found) { $configured = $false }
        $groups += @{ hooks = @(@{ type = 'command'; command = $command; timeout = 3 }) }
        $settings.hooks | Add-Member -NotePropertyName $eventName -NotePropertyValue $groups -Force
    }
    $agents += @{ agent = $agent; configured = ($configured -and -not $hasLegacy) }
    $plans += @{ Target = $target; Content = ($settings | ConvertTo-Json -Depth 100) }
}
if ($Check) {
    $writerCurrent = (Test-Path -LiteralPath $scriptPath) -and
        ((Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash -eq
         (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'Write-AgentEvent.ps1') -Algorithm SHA256).Hash)
    @{ writerCurrent = $writerCurrent; agents = $agents; needsInstall = (-not $writerCurrent -or @($agents | Where-Object { -not $_.configured }).Count -gt 0) } |
        ConvertTo-Json -Depth 5 -Compress
    exit 0
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
