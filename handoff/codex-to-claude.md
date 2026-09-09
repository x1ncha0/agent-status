# Codex CLI → Claude Code

## 2026-09-09 — codex

Status: ready

Đã tạo vùng handoff dùng chung. Hãy ghi các việc cần Codex tiếp tục vào `claude-to-codex.md`; Codex sẽ ghi kết quả vào file này.

## 2026-09-09 21:20 — codex

Status: ready

Đã tiếp tục kiểm tra project:

- Sửa kiểm thử `alwaysOnTop`: Electron ghi rõ `isAlwaysOnTop()` trên Windows không phải native assertion đáng tin cậy. Smoke test hiện xác nhận `setAlwaysOnTop()` phát `always-on-top-changed=true`; README/VERIFICATION đã ghi giới hạn này.
- `npm run check`: pass.
- `npm test`: 9/9 pass.
- `npm run smoke`: pass; window 110×55, sandbox/preload/IPC, drag region, Show/Hide và pipeline event PowerShell → file → monitor → IPC → DOM cho Claude/Codex đều pass.
- `npm run dist`: pass sau khi nén portable; `release/AgentStatus.exe` đã được tạo lại, kèm `integration/`, README, VERIFICATION và SHA256.
- Claude Code live test đã phát `SessionStart → UserPromptSubmit → Stop → SessionEnd`.
- Codex live approval/input chưa kiểm tra vì cần review/trust hook bằng `/hooks`.
- Tray menu chưa xác minh được bằng UI Automation; cần test thủ công Hide/Show/Exit. Electron tray icon được tạo và nằm trong vùng hidden icons trên Windows test machine.

Files chính cần đọc nếu tiếp tục: `src/main/window.ts`, `scripts/smoke.cjs`, `scripts/Verify-Windows.ps1`, `README.md`, `VERIFICATION.md`.

## 2026-09-09 — codex

Status: needs-user-action

Người dùng đang thấy Codex hiển thị `Chưa nhận event`. Đã kiểm tra local machine:

- `%USERPROFILE%\.codex\hooks.json` tồn tại và có hooks cho `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, `SessionEnd`, `Interrupt`.
- Command hook trỏ đúng tới `%LOCALAPPDATA%\AgentStatus\Write-AgentEvent.ps1`.
- Writer tồn tại và event directory là `%LOCALAPPDATA%\AgentStatus\events\codex`.

Khả năng chính: Codex CLI chưa review/trust hooks bằng `/hooks`, hoặc người dùng đang nói tới phiên Codex trong giao diện chat hiện tại. Agent Status chỉ theo dõi `codex` CLI local chạy trên Windows; không nhận event từ phiên chat/hosted agent.

Cách tiếp tục cho người dùng:

1. Mở `codex` CLI local trong Terminal.
2. Chạy `/hooks`, review/trust các hook gọi `Write-AgentEvent.ps1`.
3. Thoát Codex CLI hoàn toàn và mở lại session mới.
4. Gửi prompt; kiểm tra chấm chuyển `Chưa nhận event → Working → Available`.

Chưa xác nhận live Codex event sau trust. Không tự bypass hook trust.
