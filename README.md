# Agent Status

[![Release](https://img.shields.io/github/v/release/x1ncha0/agent-status?label=b%E1%BA%A3n%20m%E1%BB%9Bi%20nh%E1%BA%A5t&color=2ea44f)](https://github.com/x1ncha0/agent-status/releases/latest)
[![Lượt tải](https://img.shields.io/github/downloads/x1ncha0/agent-status/total?label=l%C6%B0%E1%BB%A3t%20t%E1%BA%A3i&color=blue)](https://github.com/x1ncha0/agent-status/releases)
[![Nền tảng](https://img.shields.io/badge/n%E1%BB%81n%20t%E1%BA%A3ng-Windows%2010%2F11%20x64-0078d4?logo=windows&logoColor=white)](#chạy-và-build)
[![Giấy phép](https://img.shields.io/github/license/x1ncha0/agent-status?label=gi%E1%BA%A5y%20ph%C3%A9p)](LICENSE)

Utility Windows local hiển thị trạng thái **Claude Code** và **Codex CLI** trong cửa sổ mặc định `110 × 55` DIP, luôn nổi, kéo được, không chiếm Taskbar. Kéo cạnh hoặc góc để thay đổi chiều rộng / cao; nhỏ nhất `90 × 45` DIP. App nhớ cả vị trí và kích thước. Tray có Show/Hide, Thiết lập kết nối, Exit và Start with Windows.

| Đèn | Ý nghĩa |
|---|---|
| Xanh | Sẵn sàng, đang rảnh hoặc đã hoàn thành |
| Vàng | Đang suy nghĩ hoặc làm việc, kể cả tác vụ lâu không có output |
| Đỏ | Cần bạn can thiệp: cấp quyền/từ chối quyền hoặc trả lời câu hỏi |
| Chấm rỗng | Chưa kết nối được nguồn trạng thái; hover để xem lý do |

Đỏ không dùng để suy đoán agent bị treo. Cấu hình `noProgressMinutes` cũ không còn tác dụng. Lỗi tool riêng lẻ vẫn là đang làm việc; lượt kết thúc vì API error trở về rảnh và tooltip ghi lý do.

## Tải về

[![Tải AgentStatus.exe](https://img.shields.io/badge/T%E1%BA%A3i-AgentStatus.exe-2ea44f?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/x1ncha0/agent-status/releases/latest/download/AgentStatus.exe)

Portable, không cần cài đặt, không cần Node.js. Link trên luôn trỏ tới bản mới nhất nên không cần sửa mỗi lần phát hành.
Xem toàn bộ bản phát hành và ghi chú thay đổi tại [Releases](https://github.com/x1ncha0/agent-status/releases).
Chi tiết phiên bản hiện tại và hướng dẫn nâng cấp: [RELEASE_NOTES.md](RELEASE_NOTES.md).

Đối chiếu checksum trước khi chạy, so với `AgentStatus.exe.sha256` đi kèm trong cùng bản phát hành:

```powershell
(Get-FileHash AgentStatus.exe -Algorithm SHA256).Hash
```

Hoặc tải bằng dòng lệnh:

```powershell
gh release download --repo x1ncha0/agent-status --pattern "AgentStatus.exe"
```

Sau khi tải, chạy trực tiếp. Lần đầu, app tự kiểm tra và hiện nút **Cài đặt kết nối** nếu thiếu integration; không cần tải thêm thư mục hay chạy lệnh. Sau đó mở lại CLI; riêng Codex cần vào `/hooks` để Review / Trust rồi gửi một yêu cầu trong cửa sổ mới. Khi cập nhật lên bản mới, tắt Agent Status đang chạy trước khi ghi đè file.

## Chạy và build

Windows 10/11 x64; Node.js 22+ để phát triển. Phiên bản CLI đã kiểm tra trên máy: Claude Code `2.1.247`, Codex `0.153.4`.

```powershell
npm ci
npm exec -- install-electron
npm run check
npm test
npm start
npm run smoke
npm run dist
```

Đóng Agent Status trước khi build lại để Windows không khóa executable. `npm run dist` tạo **`release/AgentStatus.exe`** portable, kèm `integration/`, tài liệu và SHA256. Executable đã có runtime, không cần Node.js riêng. Đặt file ở đường dẫn cố định trước khi bật **Start with Windows**; nếu di chuyển file, tắt/bật lại tùy chọn này.

## Cài hoặc cập nhật integration

**Nâng cấp lên 1.0.3:** cài / cập nhật kết nối trong app để thay hook cũ có `-WindowStyle Hidden`, vốn có thể làm ẩn hoặc thu nhỏ terminal chạy Codex. Installer tự nhận diện và thay các handler cũ của Agent Status, giữ hook khác. Vì command đã đổi, Codex cần bạn Review / Trust lại trong `/hooks`, rồi dùng phiên mới. Chỉ thay `.exe` mà giữ hook cũ sẽ chưa sửa lỗi terminal.

**Trong app:** bấm **Cài đặt kết nối** ở lần mở đầu, hoặc nhấp phải biểu tượng khay hệ thống → **Thiết lập kết nối…** để kiểm tra, cài lại và xem hướng dẫn. App dùng script đi kèm executable, tự sao lưu cấu hình hiện có rồi thêm hooks. Máy đã cài đủ sẽ không hiện thiết lập khi khởi động. Chọn **Để sau** sẽ ngừng nhắc cho phiên bản integration đó; vẫn có thể mở lại từ menu khay hệ thống.

Codex yêu cầu bạn Review / Trust hooks; app không tự cấp Trust. Các phiên CLI mở trước lúc cài có thể chưa nhận cấu hình, vì vậy hãy mở terminal mới, chạy `codex`, vào `/hooks` rồi gửi một yêu cầu. Tooltip của đèn chưa kết nối cũng nhắc các bước này.

**Cài bằng dòng lệnh (tùy chọn):**

```powershell
powershell.exe -NoProfile -File .\integration\Install-Hooks.ps1 -Check
powershell.exe -NoProfile -File .\integration\Install-Hooks.ps1
powershell.exe -NoProfile -File .\integration\Install-Hooks.ps1 -Apply
```

`-Check` chỉ kiểm tra và trả kết quả JSON, không ghi cấu hình. Không truyền tham số là preview. `-Apply` backup và merge hooks vào `~/.claude/settings.json` và `$CODEX_HOME/hooks.json` (mặc định `~/.codex/hooks.json`), copy writer vào `%LOCALAPPDATA%\AgentStatus\Write-AgentEvent.ps1`. Giữ các hook khác đã có.

Mở CLI và review/trust các command mới trong **`/hooks`**. Codex bỏ qua hook chưa trust. Sau khi cài lần đầu, mở session mới. Khi nâng cấp từ bản cũ, cập nhật cả writer bằng installer; chỉ thay executable sẽ chưa có metadata tiến trình để khôi phục phiên cũ.

Với writer mới, có thể mở Agent Status trước **hoặc sau** Codex. Ứng dụng khôi phục trạng thái của phiên còn chạy, kể cả đang thinking hoặc chờ trả lời, và loại trạng thái của tiến trình đã đóng. Hook không có metadata tiến trình chỉ được dùng khi vừa nhận, không khôi phục sau restart.

Nếu chuyển sang máy khác, chỉ cần chuyển `AgentStatus.exe` và dùng bước thiết lập trong app. Chỉ cần thư mục `integration/` riêng nếu muốn chạy installer bằng dòng lệnh. Không copy cấu hình của máy cũ. Không tự bypass execution policy, organization policy hoặc hook trust.

Gỡ integration: chỉ xóa các handler gọi `Write-AgentEvent.ps1` trong hai file cấu hình; giữ handler khác. Hoặc khôi phục backup `.agent-status-<GUID>.bak` nếu từ đó chưa có thay đổi khác. Tắt Start with Windows trước khi xóa executable.

## Kiến trúc

```text
CLI hook → PowerShell writer → event JSON local
         → FileMonitor → classifier / StatusStore
         → Electron main → IPC / preload → renderer → đèn
```

`src/monitor/` giữ detection, trạng thái từng session và kiểm tra tiến trình. `src/main/` quản lý window/tray; `src/renderer/` hiển thị. Renderer chạy sandbox, `contextIsolation: true`, `nodeIntegration: false`, không truy cập filesystem hay network. Ứng dụng không có server, cloud, telemetry hay đồng bộ dữ liệu.

Vùng nội dung dùng để kéo di chuyển; viền dành cho resize native của Windows. Cửa sổ dùng nền tối đặc để hỗ trợ resize. `position.json` lưu `x`, `y`, `width`, `height`, vẫn đọc được file cũ chỉ có vị trí; khi đổi màn hình, app giới hạn lại vị trí / kích thước trong vùng làm việc.

Writer chỉ ghi agent, session ID, event, timestamp, tên/ID tool, loại notification/source và PID/thời điểm tạo tiến trình CLI. Không lưu prompt, arguments, tool output hoặc transcript. Writer tìm CLI trong chuỗi tiến trình cha; không dùng trạng thái tồn tại của process để đoán đang thinking hay hỏi người dùng.

Main poll mỗi 500 ms, tối đa 1000 event files mỗi lượt mỗi agent. Giữ metadata trạng thái hiện tại trong `events/<agent>/state.json`, ghi atomically trước khi xóa event đã xử lý. Đây không phải lịch sử hội thoại. Khi khôi phục, kiểm tra cả PID và thời điểm tạo process để tránh nhầm PID đã được Windows tái sử dụng. Kết quả kiểm tra process được cache 2 giây. Nếu không đọc được nguồn, tooltip ghi lỗi và chấm rỗng; lỗi monitor không làm đèn đỏ.

Nguồn hook chính thức: [Codex Hooks](https://learn.chatgpt.com/docs/hooks), [Claude hooks](https://code.claude.com/docs/en/hooks).

| Event | Trạng thái |
|---|---|
| `SessionStart` | Xanh; `source: compact` là vàng |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact` | Vàng |
| `PermissionRequest` | Đỏ, chờ cấp quyền/từ chối |
| Claude `AskUserQuestion`, `Elicitation`, notification yêu cầu quyền/input | Đỏ, chờ câu trả lời |
| Codex `request_user_input`, `request_user_input_async` qua hook `PreToolUse` | Đỏ, chờ câu trả lời |
| Tool hỏi đồng bộ hoàn tất / `ElicitationResult` | Vàng |
| `Stop`, Codex `Interrupt` | Xanh; câu hỏi bất đồng bộ chưa trả lời vẫn giữ đỏ sau `Stop` |
| `SessionEnd` hoặc tiến trình CLI kết thúc | Loại task của session |

Theo dõi `tool_use_id` giúp tool song song không xóa trạng thái câu hỏi khác đang chờ. Với câu hỏi bất đồng bộ, `PostToolUse` chỉ báo đã hiển thị câu hỏi nên chưa xóa đỏ; prompt người dùng tiếp theo xóa trạng thái chờ. Nhiều session ưu tiên đỏ > vàng > xanh. Claude `idle_prompt` không làm đèn đỏ.

## Giới hạn

- Hỗ trợ CLI native Windows với hooks được cài và trust. WSL, remote/cloud và mọi client Desktop/IDE chưa được kiểm chứng.
- Approval hook chạy trước khi biết hook khác hoặc cơ chế review tự động có chấp nhận hay không. Đỏ có thể hiện ngắn rồi phục hồi khi có activity. Không có approval-resolved hook chung; khi không có ID, ghép bằng tên tool có thể nhầm giữa các tool song song cùng tên.
- Chỉ nhận câu hỏi qua hook/tool được hỗ trợ, không đoán từ dấu hỏi trong văn bản. Không bảo đảm phát hiện mọi câu hỏi viết trong câu trả lời cuối cùng hoặc câu hỏi từ client không phát hook. Với input bất đồng bộ, việc phục hồi phụ thuộc client phát `UserPromptSubmit` khi người dùng trả lời.
- Khi quyền đọc thông tin process bị chặn ở writer, event mới vẫn hoạt động nhưng không khôi phục trạng thái đó sau restart. Một process phục vụ nhiều session chỉ loại hết trạng thái khi process đóng; cần `SessionEnd` để nhận biết từng session đóng trong process còn sống.
- Hooks chạy kể cả khi ứng dụng tắt nên event files có thể tích lại. Clock hệ thống thay đổi lớn có thể ảnh hưởng thứ tự event. Snapshot không chứng minh health/login/quota của CLI.
- Subagent không có đèn riêng; hook có thể dùng ID của parent. Không bảo đảm theo dõi mọi background child sau parent Stop.
- Executable chưa code-sign. Electron dùng Chromium nên RAM/dung lượng lớn hơn utility Win32.

## Kiểm tra

`npm test` kiểm tra lifecycle, quyền/input, tool song song, tác vụ lâu, khôi phục sau restart, tiến trình đã đóng/PID tái sử dụng, lỗi nguồn, lọc dữ liệu riêng tư và installer. `npm run smoke` kiểm tra Electron thật với event giả lập đến IPC/DOM/màu/tooltip. `scripts/verify-live.cjs` kiểm tra Codex thật đang làm việc, cần đóng Agent Status trước rồi chạy `electron scripts/verify-live.cjs`.

Kiểm tra thủ công: mở Codex rồi mở Agent Status; gửi task → vàng; giữ prompt approval/câu hỏi → đỏ; trả lời → vàng; hoàn thành → xanh. Mở lại Agent Status giữa task và đóng CLI khi đang chờ để kiểm tra khôi phục/loại phiên cũ. Kiểm tra tray Show/Hide/Exit, kéo cửa sổ, vị trí sau restart và Start with Windows bằng đăng nhập lại.

Kết quả đã chạy và giới hạn kiểm chứng ở [VERIFICATION.md](VERIFICATION.md).
