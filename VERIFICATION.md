# Kết quả kiểm thử

Ngày 09/09/2026, Windows `10.0.26200`, Node.js `22.15.0`, Electron `44.3.0`.

- `npm run check`: qua.
- `npm test`: 9 tests qua; lifecycle cả hai agent, input/error, multi-session, event cũ, timeout/recovery, validation, PowerShell writer thật, loại bỏ prompt/tool input, installer preview/merge/idempotence.
- `npm audit`: 0 vulnerabilities sau khi nâng Electron.
- `npm run smoke`: qua. Window visible `110 × 55` DIP, sandbox/preload/IPC, CSS drag region, di chuyển bằng API, native Show/Hide và `always-on-top-changed`. Event giả lập của cả hai agent đi qua PowerShell/file/monitor/IPC và đổi đúng DOM cho Available/Working/Stuck/recovery.
- Đã xem ảnh window tạo bởi Electron `capturePage`; layout đúng hai chấm màu và tên.

Đã chạy Claude Code thật với prompt ngắn không dùng tool và nhận `OK`. Observer đọc được `SessionStart → UserPromptSubmit → Stop → SessionEnd` từ integration đã cài vào user settings. App đang chạy đã tiêu thụ/xóa event files. Việc đổi màu đến DOM đã kiểm tra riêng bằng smoke test; chưa ghi hình trực tiếp màu ở từng giai đoạn của live prompt.

Đã cài hooks trên máy bằng `Install-Hooks.ps1 -Apply`, giữ cấu hình cũ và tạo backups. Codex vẫn cần người dùng review/trust trong `/hooks`. Không sửa trust store hoặc bật bypass.

`npm run dist`: đã tạo `release/AgentStatus.exe` khoảng 95 MiB. Đã mở portable executable thật. `scripts/Verify-Windows.ps1` xác nhận Windows window visible, không có caption/`WS_EX_APPWINDOW`, kích thước 110×55 pixel trên màn hình kiểm thử. `BrowserWindow.isAlwaysOnTop()` không được dùng làm native assertion vì Electron ghi rõ API này luôn trả `false` trên Windows; smoke test xác nhận app gọi `setAlwaysOnTop` và nhận `always-on-top-changed`. Portable giải nén Electron vào thư mục temp khi chạy; startup option dùng `PORTABLE_EXECUTABLE_FILE` để lưu đường dẫn gốc.

Đã thử kéo bằng Windows mouse input trên bản portable: con trỏ dịch -30/-30 pixel, window dịch -27/-27 (Windows bắt đầu drag sau ngưỡng vài pixel); khôi phục vị trí window/con trỏ sau test. Bài test đầu đòi đúng 30 pixel nên báo fail; đã sửa assertion chấp nhận ngưỡng drag 6 pixel, không sửa code ứng dụng.

Đã thử Windows UI Automation cho tray nhưng không tìm được icon qua accessibility tree; chưa kết luận menu Hide/Show/Exit hoạt động bằng thao tác native. Native Show/Hide API đã qua smoke test. Script PowerShell có tiếng Việt được lưu UTF-8 BOM để tương thích Windows PowerShell 5.1.

Chưa xác nhận bằng thao tác người dùng: menu tray, luôn nổi trước các ứng dụng khác/fullscreen, đăng nhập lại Windows để kiểm tra startup. Chưa xác nhận live Claude approval/input/API error hoặc live Codex lifecycle/approval/input sau trust. Làm theo phần kiểm tra thủ công trong README; không coi fixture tests là live CLI tests. Không cố tình gây crash hoặc làm thay đổi policy để tạo Stuck.
