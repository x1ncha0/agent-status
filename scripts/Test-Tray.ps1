$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AgentStatusTrayCheck {
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c,string t);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 public struct POINT { public int X,Y; }
}
'@
$root = [System.Windows.Automation.AutomationElement]::RootElement
$children = [System.Windows.Automation.TreeScope]::Children
$descendants = [System.Windows.Automation.TreeScope]::Descendants
function By-Class([string]$value) { [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, $value) }
function By-Name([string]$value) { [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $value) }
function Open-AgentMenu {
    $taskbar = $root.FindFirst($children, (By-Class 'Shell_TrayWnd'))
    $panel = $root.FindFirst($children, (By-Class 'TopLevelWindowForOverflowXamlIsland'))
    if (-not $panel) {
        $overflow = $taskbar.FindFirst($descendants, (By-Name 'Show Hidden Icons'))
        if ($overflow) { $overflow.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 400 }
        $panel = $root.FindFirst($children, (By-Class 'TopLevelWindowForOverflowXamlIsland'))
    }
    $containers = @($taskbar)
    if ($panel) { $containers += $panel }
    $icon = $null
    foreach ($container in $containers) {
        foreach ($element in $container.FindAll($descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
            if ($element.Current.Name -match 'claude:|codex:|Agent Status') { $icon = $element; break }
        }
    }
    if (-not $icon) { throw 'UI Automation không tìm được Agent Status tray icon.' }
    $bounds = $icon.Current.BoundingRectangle
    [void][AgentStatusTrayCheck]::SetCursorPos([int]($bounds.X + $bounds.Width / 2), [int]($bounds.Y + $bounds.Height / 2))
    [AgentStatusTrayCheck]::mouse_event(8, 0, 0, 0, [UIntPtr]::Zero)
    [AgentStatusTrayCheck]::mouse_event(16, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 400
    $menu = $root.FindFirst($children, (By-Class '#32768'))
    if (-not $menu) { throw 'Không tìm được native tray context menu.' }
    return $menu
}
$handle = [AgentStatusTrayCheck]::FindWindow('Chrome_WidgetWin_1', 'Agent Status')
if ($handle -eq [IntPtr]::Zero) { throw 'Agent Status chưa chạy.' }
$cursor = New-Object AgentStatusTrayCheck+POINT
[void][AgentStatusTrayCheck]::GetCursorPos([ref]$cursor)
$checks = @()
try {
    foreach ($label in @('Hide','Show','Exit')) {
        $menu = Open-AgentMenu
        $item = $menu.FindFirst($descendants, (By-Name $label))
        if (-not $item) { throw "Không tìm thấy menu item $label" }
        $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Start-Sleep -Milliseconds 400
        if ($label -eq 'Hide' -and [AgentStatusTrayCheck]::IsWindowVisible($handle)) { throw 'Hide không ẩn window.' }
        if ($label -eq 'Show' -and -not [AgentStatusTrayCheck]::IsWindowVisible($handle)) { throw 'Show không hiện window.' }
        if ($label -eq 'Exit' -and [AgentStatusTrayCheck]::IsWindow($handle)) { throw 'Exit chưa đóng window.' }
        $checks += $label
    }
    @{ checks = $checks } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '..\.test-data\tray.json') -Encoding utf8
    $checks
} finally {
    # Chỉ đóng window Agent Status của bài test, giải phóng portable executable cho builder.
    if ([AgentStatusTrayCheck]::IsWindow($handle)) { [void][AgentStatusTrayCheck]::PostMessage($handle, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
    [void][AgentStatusTrayCheck]::SetCursorPos($cursor.X, $cursor.Y)
}
