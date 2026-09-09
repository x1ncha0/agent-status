# Agent Status

Utility Windows local hiển thị status của **Claude Code** và **Codex CLI** trong window `110 × 55` DIP, luôn nổi, kéo được, không chiếm Taskbar. Có system tray: Show/Hide, Exit và Start with Windows. Không có server, database, cloud, remote synchronization hay telemetry của ứng dụng.

## Chạy và build

Yêu cầu Windows 10/11 x64, Node.js 22+ để phát triển; CLI chạy native Windows. Phiên bản đã kiểm tra trên máy: Claude Code `2.1.247`, Codex CLI `0.153.4`. Máy khác cần phiên bản hỗ trợ những hooks bên dưới.

```powershell
npm ci
npm run check
npm test
npm start
npm run smoke
npm run dist
```

Đóng Agent Status trước khi build lại để Windows không khóa executable đầu ra. `npm run dist` tạo **`release/AgentStatus.exe`** (portable, chưa ký code signing), kèm `integration/`, tài liệu và checksum SHA256. Bản executable không cần Node.js riêng; Electron đã đóng gói runtime. Đặt file ở đường dẫn cố định trước khi bật **Start with Windows**. Khi di chuyển file, tắt/bật lại startup option. Electron dùng Chromium nên dung lượng/RAM lớn hơn utility viết bằng Win32 dù code và UI nhỏ.

## Cài hooks một lần trên mỗi máy

Chạy từ thư mục project bằng PowerShell. Lệnh đầu chỉ in preview; lệnh sau backup rồi merge cấu hình, không thay thế các hook khác.

```powershell
powershell.exe -NoProfile -File .\integration\Install-Hooks.ps1
powershell.exe -NoProfile -File .\integration\Install-Hooks.ps1 -Apply
```

Script copy writer vào `%LOCALAPPDATA%\AgentStatus\Write-AgentEvent.ps1`, thêm hooks vào `~/.claude/settings.json` và `$CODEX_HOME/hooks.json` (mặc định `~/.codex/hooks.json`). Mở session CLI mới. Trong Codex, dùng **`/hooks` để review và trust** các command vừa thêm; hook chưa trust sẽ bị bỏ qua. Claude cũng có `/hooks` để kiểm tra. Không dùng bypass approval/trust.

Nếu chỉ chuyển executable sang máy khác, chuyển kèm thư mục `integration/` và chạy script tại máy đó. Trong bản unpacked, scripts cũng nằm ở `release/win-unpacked/resources/integration/`. Không copy cấu hình máy cũ vì đường dẫn khác nhau. Không tự bật hooks bị organization policy tắt. Nếu PowerShell execution policy chặn script, xử lý theo policy của máy; ứng dụng không tự bypass.

Gỡ integration: trong hai file cấu hình, chỉ xóa các handler gọi `Write-AgentEvent.ps1`; giữ handler khác. Hoặc khôi phục file `.agent-status-<GUID>.bak` nếu từ đó chưa có thay đổi cấu hình khác. Tắt Start with Windows trước khi xóa executable.

## Kiến trúc để đọc code

Electron có **main process** quản lý native window/tray và truy cập file; **renderer** hiển thị HTML/CSS. `BrowserWindow` tạo window; `frame: false` bỏ title bar, `alwaysOnTop: true` bật nổi, `skipTaskbar: true` ẩn khỏi Taskbar. CSS `-webkit-app-region: drag` cho phép kéo nền. Vị trí được lưu và điều chỉnh vào work area khi cấu hình màn hình thay đổi.

```text
CLI hook → PowerShell writer → file JSON local
         → FileMonitor → classifier → StatusStore
         → Electron main → IPC/preload → renderer → chấm màu
```

`preload.ts` dùng `contextBridge` chỉ mở hai chức năng đọc/subscribe status. Renderer chạy sandbox, `contextIsolation: true`, `nodeIntegration: false`; không truy cập filesystem, CLI hay network. `status:get` lấy snapshot ban đầu, `status:changed` cập nhật khi dữ liệu đổi.

```text
src/main/       main.ts, window.ts, tray.ts, preload.ts
src/monitor/    status.ts, file-monitor.ts, claude.ts, codex.ts
src/renderer/   index.html, app.ts, style.css
src/tests/      monitor.test.ts
integration/    Install-Hooks.ps1, Write-AgentEvent.ps1
scripts/        copy-assets.cjs, smoke.cjs
handoff/        vùng ghi nhận bàn giao giữa Claude Code và Codex CLI
```

`Monitor` là interface chung; classifier riêng chuyển event thành transition. `StatusStore` giữ từng session trong RAM. Khi thêm agent, thêm classifier/monitor và tên UI; không đưa detection logic vào renderer.

## Detection đã nghiên cứu ngày 09/09/2026

Nguồn: [Claude hooks reference](https://code.claude.com/docs/en/hooks), [Codex Hooks](https://learn.chatgpt.com/docs/hooks), [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference), [Codex app-server](https://learn.chatgpt.com/docs/app-server).

Cả hai CLI hiện hỗ trợ command hooks, JSON trên `stdin`. Codex có `notify` và app-server runtime status nhưng lifecycle hooks phù hợp hơn cho observer nhỏ không mở server. Không dùng process existence, terminal title hay transcript parser để suy luận agent đang làm việc. Transcript không phải stable interface của Codex.

| Event/điều kiện | Status của ứng dụng |
|---|---|
| `SessionStart` | Available; riêng `source: compact` là Working |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact` | Working |
| `PermissionRequest` | Stuck: approval đã được yêu cầu, chờ activity tiếp theo |
| `Stop` | Available |
| `SessionEnd` | Loại session khỏi các task đang hoạt động |
| Claude `PreToolUse` với `AskUserQuestion`, `Elicitation` | Stuck: cần input |
| Claude `ElicitationResult`, `PostToolUseFailure` | Working: agent có thể tiếp tục xử lý |
| Claude `StopFailure` | Stuck: turn kết thúc vì API error |
| Claude `Notification` loại permission/input được nhận diện | Stuck |
| Codex `PreToolUse` với `request_user_input` | Stuck: cần input khi tool đi qua hook path |
| Codex `Interrupt` | Available: người dùng chủ động ngắt turn |

Claude notification được nhận diện: `permission_prompt`, `elicitation_dialog`, `elicitation_url_dialog`, `agent_needs_input`. `idle_prompt` được bỏ qua: idle sau khi hoàn thành không phải Stuck. Không phân tích nội dung câu trả lời để đoán đang hỏi người dùng. Tool failure riêng lẻ không tự thành Stuck.

Giữ đúng kiểu `Agent = "claude" | "codex"`, `Status = "available" | "working" | "stuck"`. Metadata `observed` tách độ tin cậy khỏi status: **chấm rỗng** khi chưa nhận hook sau khi app mở hoặc không đọc được nguồn event. Chấm rỗng không phải status thứ tư và không khẳng định CLI đã cài/sẵn sàng. Hover để xem lý do. Nếu nhiều session, ưu tiên Stuck > Working > Available.

Writer chỉ lưu agent/session/event/timestamp và tên tool/notification/source; không lưu prompt, tool arguments hay transcript. Ghi `.tmp` rồi rename giúp tránh đọc nửa file. Command hook chạy synchronous, timeout 3 giây: hạn chế đảo thứ tự do chạy background nhưng có chi phí khởi động PowerShell cho mỗi event. Writer không trả approval decision và lỗi ghi file không được chặn agent.

Main poll mỗi 500 ms, tối đa 1000 file mỗi lượt mỗi agent, xóa file sau khi đọc; không có history/database. Hooks chạy kể cả khi app tắt, nên event files có thể tích lại; khi app mở sẽ xóa event cũ mà không suy luận trạng thái từ chúng. Mở app trước CLI để nhận toàn bộ lifecycle.

## Stuck và timeout

Mặc định timeout **tắt**: không có event chưa chứng minh agent bị treo. Có thể tạo `%LOCALAPPDATA%\AgentStatus\config.json` rồi mở lại app:

```json
{ "noProgressMinutes": 15 }
```

Giá trị từ 1 phút trở lên bật timeout. `0`/bỏ file tắt timeout. Chỉ session đang Working bị chuyển thành Stuck khi hết thời gian không có event được nhận diện. Tooltip ghi rõ đây là suy đoán. Activity tiếp theo phục hồi status. Long-running command, model reasoning hoặc hosted tool không phát hook có thể bị báo nhầm.

## Giới hạn thực tế

- Hooks phải được cài, trust và không bị policy/CLI option tắt. CLI cũ không hỗ trợ không được đoán status bằng process. WSL, remote sessions và client khác chưa được hỗ trợ/kiểm chứng.
- Approval hook có thể được hook khác auto-approve; màu đỏ có thể chỉ thoáng qua hoặc giữ đến event tiếp theo. Không có approval-resolved hook chung cho hai CLI. Activity của tool song song trong cùng session có thể làm mất dấu trạng thái chờ; đây không phải debugger chính xác từng tool.
- `Stop` là lúc hooks chạy, chưa bảo đảm mọi Stop hook khác đồng ý kết thúc. Agent có thể tiếp tục và đổi về Working ở event tiếp theo.
- Không phát hiện chắc chắn process crash, mất auth, mọi terminal question hoặc mọi API error của Codex. Kill cưỡng bức có thể không phát `SessionEnd`; status cuối giữ trong RAM đến event mới hoặc app restart. Timeout tùy chọn chỉ hỗ trợ trường hợp Working.
- Subagent/teammate không có indicator riêng; hooks có thể dùng session id của parent. Không bảo đảm theo dõi đầy đủ mọi background child sau parent Stop.
- Available nghĩa là không có task đang chạy **theo event quan sát**, không phải kiểm tra health/login/quota. Session đã đóng cũng không đóng góp task đang chạy.
- App restart không khôi phục trạng thái từ log cũ; đợi event mới hoặc mở session mới. Clock hệ thống thay đổi lớn có thể ảnh hưởng thứ tự event/timeout.
- Startup được triển khai bằng Electron login item; cần kiểm tra qua đăng nhập lại Windows. App chưa code-sign, Windows có thể hiển thị cảnh báo khi tải/chạy file chưa ký.

## Kiểm tra thủ công

1. Mở executable: ban đầu chấm rỗng nếu chưa có event. Kéo nền, mở window khác, kiểm tra Agent Status vẫn nổi và không có Taskbar button. Exit rồi mở lại để kiểm tra vị trí.
2. Trong tray, thử Hide, Show và double-click; Exit phải đóng cả window/tray. Bật Start with Windows rồi đăng nhập lại để kiểm tra; tắt nếu không muốn.
3. Cài hooks, trust Codex `/hooks`, mở session mới: Available. Gửi task đủ dài: Working. Khi CLI hoàn thành: Available.
4. Cho CLI thực hiện thao tác thực sự cần approval trong sandbox, giữ prompt approval chưa trả lời: Stuck. Approve/deny rồi đợi tool hoặc turn event để kiểm tra phục hồi. Không tắt sandbox để test.
5. Với Claude, thử task khiến `AskUserQuestion`/MCP input xuất hiện. Với Codex, thử Plan mode có `request_user_input`; coverage tùy tool path. Không thể bảo đảm model sẽ gọi đúng tool mỗi lần.
6. Để thử timeout, đặt 1 phút rồi chạy task im lặng lâu hơn; đọc tooltip để phân biệt timeout với approval thật. Xóa config sau khi thử.

Kết quả tự động và phần chưa xác minh được ghi ở [VERIFICATION.md](VERIFICATION.md). `npm test` kiểm tra reducer/PowerShell/integration config. `npm run smoke` mở Electron thật và dùng event giả lập để kiểm tra toàn bộ pipeline đến DOM; không chứng minh CLI thật đã phát event.
