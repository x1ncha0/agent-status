# Codex CLI → Claude Code

## 2026-09-11 — codex: tự ẩn agent không hoạt động

Status: ready

Renderer ẩn toàn bộ agent khi `observed: false`, agent còn lại căn giữa. Cửa sổ khởi động ở trạng thái ẩn, chỉ hiện khi có agent hoạt động; khi không còn agent thì tự ẩn và khi có phiên mới thì tự hiện bằng `showInactive`. Việc đổi màu không bật lại cửa sổ đã Hide thủ công. Show qua tray / mở app lần hai được chặn khi không có agent, còn thiết lập và Exit vẫn nằm trong tray.

`npm run check`, `npm test` (16/16), `npm run smoke` và `npm run dist` qua. Smoke kiểm tra empty startup, đủ ba màu, nhiều session, đóng từng agent / agent cuối, tự hiện lại, giữ bounds và Hide thủ công; report / ảnh ở `.test-data/smoke-1789114588699/`. Bản portable nằm ở `release/AgentStatus.exe`; phiên bản phát hành là `1.0.5`.

## 2026-09-11 — codex: release 1.0.4 và icon/update menu

Status: ready

Đã cập nhật README gọn hơn, thêm icon cho executable/tray, mục **Kiểm tra cập nhật** trong menu khay hệ thống và sửa trạng thái để CLI đã đóng chuyển về chấm rỗng. Tooltip hover đã bỏ khỏi UI vì toàn bộ vùng status tiếp tục là vùng kéo cửa sổ.

Đã bump version lên `1.0.4` và cập nhật release notes. `npm run check`, `npm test` (16/16) và `npm run dist` pass; executable mới nằm ở `release/AgentStatus.exe`.

## 2026-09-11 — codex: regression Codex prompt/question

Status: ready

Đã bổ sung nhận diện `request_user_input` cho tên tool có namespace, prefix `functions.` hoặc dạng async/case khác để câu hỏi luôn giữ đèn đỏ. Installer tiếp tục loại hook Agent Status cũ có `-WindowStyle Hidden`, nguyên nhân đã biết làm terminal Codex bị minimize; cấu hình hiện tại đã được migrate và không còn flag này.

Đã kiểm tra `npm test` 16/16 và `npm run smoke` pass. Commit `9437e07` trên branch `fix/codex-question-window` đã push lên origin, chờ PR vào `main`. Nếu Codex còn dùng phiên cũ, cần restart phiên để nạp hook mới.

## 2026-09-11 — codex: scale giao diện và sửa hook minimize

Status: ready

Đã sửa renderer để chữ, đèn và khoảng cách tăng theo kích thước cửa sổ; scale dựa trên cạnh ngắn và không giảm dưới kích thước mặc định. Kích thước tối thiểu vẫn `90 × 45` DIP.

Đã sửa `integration/Install-Hooks.ps1` để nhận diện và loại toàn bộ hook Agent Status cũ có `-WindowStyle Hidden` hoặc bị trùng, rồi ghi đúng một hook mới cho mỗi event. Đã áp dụng trực tiếp vào `~/.codex/hooks.json` và `~/.claude/settings.json`; Codex hiện không còn command Agent Status nào chứa `WindowStyle Hidden`.

Đã cập nhật smoke test kiểm tra scale sau resize. `npm test`: 16/16 pass. `npm run smoke`: pass, gồm resize chuột thật, lưu/khôi phục bounds và kiểm tra chữ/đèn tăng kích thước. Đã build và khởi động lại `release/AgentStatus.exe` bản mới.

Người dùng cần mở lại phiên Codex để nạp hooks mới; nếu `/hooks` yêu cầu thì Review/Trust lại command Agent Status. Không cần sửa tay cấu hình.

## 2026-09-10 — codex: sửa nhận diện và ý nghĩa đèn

Status: ready

Hook Codex trên máy đã được trust và phát event thật; ghi chú chưa trust bên dưới đã cũ. Bản cũ bỏ event trước startup, không khôi phục trạng thái và không loại session theo tiến trình, có thể giữ đỏ từ phiên đã đóng.

Đã thêm PID/thời điểm tạo process và tool_use_id vào writer; snapshot metadata được giữ atomically để khôi phục phiên còn chạy, loại PID chết/tái sử dụng. Giữ câu hỏi chưa trả lời qua activity của tool khác. Bỏ timeout làm đèn đỏ; tooltip xanh = sẵn sàng/đã xong, vàng = thinking/làm việc, đỏ = cần cấp quyền/trả lời.

13 tests, TypeScript và Electron smoke qua. Live Codex hiện tại đã đi qua hook → monitor → IPC → DOM vàng trong `scripts/verify-live.cjs`. Writer đã cập nhật tại LOCALAPPDATA, có backup, không thay trust/config. README/VERIFICATION ghi coverage và giới hạn. Approval/input live vẫn cần kiểm tra bằng tương tác thật; không coi fixture là live.

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
