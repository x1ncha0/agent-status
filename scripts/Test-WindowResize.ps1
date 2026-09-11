param([Parameter(Mandatory=$true)][long]$Handle)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AgentStatusResizeCheck {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    public struct RECT { public int Left, Top, Right, Bottom; }
    public struct POINT { public int X, Y; }
}
'@
[void][AgentStatusResizeCheck]::SetProcessDPIAware()
$windowHandle = [IntPtr]$Handle
if (-not [AgentStatusResizeCheck]::IsWindow($windowHandle)) { throw 'Test window does not exist.' }
function Read-Rectangle {
    $rect = New-Object AgentStatusResizeCheck+RECT
    [void][AgentStatusResizeCheck]::GetWindowRect($windowHandle, [ref]$rect)
    return $rect
}
function Drag-Edge([string]$edge, [int]$dx, [int]$dy) {
    $before = Read-Rectangle
    $x = if ($edge -eq 'nw') { $before.Left + 1 } elseif ($edge -in @('right','se')) { $before.Right - 1 } else { [int](($before.Left + $before.Right) / 2) }
    $y = if ($edge -eq 'nw') { $before.Top + 1 } elseif ($edge -in @('bottom','se')) { $before.Bottom - 1 } else { [int](($before.Top + $before.Bottom) / 2) }
    [void][AgentStatusResizeCheck]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 100
    [AgentStatusResizeCheck]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    for ($step = 1; $step -le 10; $step++) {
        [void][AgentStatusResizeCheck]::SetCursorPos(($x + $dx * $step / 10), ($y + $dy * $step / 10))
        Start-Sleep -Milliseconds 25
    }
    [AgentStatusResizeCheck]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 150
    $after = Read-Rectangle
    $widthDelta = ($after.Right - $after.Left) - ($before.Right - $before.Left)
    $heightDelta = ($after.Bottom - $after.Top) - ($before.Bottom - $before.Top)
    $expectedX = if ($edge -eq 'nw') { -$dx } else { $dx }
    $expectedY = if ($edge -eq 'nw') { -$dy } else { $dy }
    if ([Math]::Abs($widthDelta - $expectedX) -gt 6 -or [Math]::Abs($heightDelta - $expectedY) -gt 6) {
        $hits = @()
        for ($offset = -12; $offset -le 4; $offset += 2) {
            $probeX = $before.Right + $offset
            $packed = (($y -band 0xffff) -shl 16) -bor ($probeX -band 0xffff)
            $hit = [AgentStatusResizeCheck]::SendMessage($windowHandle, 0x84, [IntPtr]::Zero, [IntPtr]$packed).ToInt32()
            $hits += "${offset}:$hit"
        }
        $point = New-Object AgentStatusResizeCheck+POINT
        $point.X = $x; $point.Y = $y
        $pointWindow = [AgentStatusResizeCheck]::WindowFromPoint($point)
        $style = [AgentStatusResizeCheck]::GetWindowLong($windowHandle, -16)
        throw "Edge $edge failed: width delta $widthDelta (expected $expectedX), height delta $heightDelta (expected $expectedY). Handle=$windowHandle pointWindow=$pointWindow style=$style hits=$hits rect=$($before | ConvertTo-Json -Compress)"
    }
    return @{ edge = $edge; widthDelta = $widthDelta; heightDelta = $heightDelta }
}
$cursor = New-Object AgentStatusResizeCheck+POINT
[void][AgentStatusResizeCheck]::GetCursorPos([ref]$cursor)
try {
    $checks = @()
    $checks += Drag-Edge 'right' 80 0
    $checks += Drag-Edge 'bottom' 0 50
    $checks += Drag-Edge 'nw' -20 -15
    $checks += Drag-Edge 'se' -40 -20
    $checks | ConvertTo-Json -Compress
} finally {
    [AgentStatusResizeCheck]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    [void][AgentStatusResizeCheck]::SetCursorPos($cursor.X, $cursor.Y)
}
