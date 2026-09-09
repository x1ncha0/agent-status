param([string]$Executable = (Join-Path $PSScriptRoot '..\release\AgentStatus.exe'), [switch]$Existing)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AgentStatusWindowCheck {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr handle, int index);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
if (-not $Existing) { Start-Process -FilePath (Resolve-Path -LiteralPath $Executable).Path -WindowStyle Hidden }
$handle = [IntPtr]::Zero
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    $handle = [AgentStatusWindowCheck]::FindWindow('Chrome_WidgetWin_1', 'Agent Status')
    if ($handle -ne [IntPtr]::Zero -and [AgentStatusWindowCheck]::IsWindowVisible($handle)) { break }
}
if ($handle -eq [IntPtr]::Zero) { throw 'Không tìm thấy window Agent Status.' }
[uint32]$windowProcessId = 0
[void][AgentStatusWindowCheck]::GetWindowThreadProcessId($handle, [ref]$windowProcessId)
$windowProcess = Get-Process -Id $windowProcessId
$extended = [AgentStatusWindowCheck]::GetWindowLong($handle, -20)
$style = [AgentStatusWindowCheck]::GetWindowLong($handle, -16)
$rect = New-Object AgentStatusWindowCheck+RECT
[void][AgentStatusWindowCheck]::GetWindowRect($handle, [ref]$rect)
$report = [ordered]@{
    executable = (Resolve-Path -LiteralPath $Executable).Path
    runningPath = $windowProcess.Path
    processId = $windowProcessId
    visible = [AgentStatusWindowCheck]::IsWindowVisible($handle)
    topmostStyle = 'not-readable-from-isAlwaysOnTop-on-Windows'
    taskbarAppWindowStyle = ($extended -band 0x40000) -ne 0
    captionStyle = ($style -band 0xC00000) -ne 0
    physicalWidth = $rect.Right - $rect.Left
    physicalHeight = $rect.Bottom - $rect.Top
}
if (-not $report.visible -or $report.captionStyle -or $report.taskbarAppWindowStyle) { throw ($report | ConvertTo-Json) }
$outputDir = Join-Path $PSScriptRoot '..\.test-data'
[IO.Directory]::CreateDirectory($outputDir) | Out-Null
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'packaged-window.json') -Encoding utf8
$report | ConvertTo-Json
