$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AgentStatusDragCheck {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
    public struct RECT { public int Left, Top, Right, Bottom; }
    public struct POINT { public int X, Y; }
}
'@
[void][AgentStatusDragCheck]::SetProcessDPIAware()
$handle = [AgentStatusDragCheck]::FindWindow('Chrome_WidgetWin_1', 'Agent Status')
if ($handle -eq [IntPtr]::Zero) { throw 'Mở Agent Status trước khi test.' }
$before = New-Object AgentStatusDragCheck+RECT
$cursor = New-Object AgentStatusDragCheck+POINT
[void][AgentStatusDragCheck]::GetWindowRect($handle, [ref]$before)
[void][AgentStatusDragCheck]::GetCursorPos([ref]$cursor)
$x = [int](($before.Left + $before.Right) / 2)
$y = $before.Top + 7
$dx = if ($before.Left -gt 50) { -30 } else { 30 }
$dy = if ($before.Top -gt 50) { -30 } else { 30 }
try {
    [void][AgentStatusDragCheck]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 150
    [AgentStatusDragCheck]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    for ($step = 1; $step -le 10; $step++) {
        [void][AgentStatusDragCheck]::SetCursorPos(($x + $dx * $step / 10), ($y + $dy * $step / 10))
        Start-Sleep -Milliseconds 30
    }
    [AgentStatusDragCheck]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 200
    $after = New-Object AgentStatusDragCheck+RECT
    [void][AgentStatusDragCheck]::GetWindowRect($handle, [ref]$after)
    $result = @{ movedX = $after.Left - $before.Left; movedY = $after.Top - $before.Top; expectedX = $dx; expectedY = $dy }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '..\.test-data\drag.json') -Encoding utf8
    # Windows chỉ bắt đầu drag sau ngưỡng vài pixel, nên window có thể dịch ít hơn cursor.
    if ([Math]::Abs($result.movedX - $dx) -gt 6 -or [Math]::Abs($result.movedY - $dy) -gt 6) { throw ($result | ConvertTo-Json) }
    $result | ConvertTo-Json
} finally {
    [AgentStatusDragCheck]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    [void][AgentStatusDragCheck]::SetWindowPos($handle, [IntPtr]::Zero, $before.Left, $before.Top, 0, 0, 0x15)
    [void][AgentStatusDragCheck]::SetCursorPos($cursor.X, $cursor.Y)
}
