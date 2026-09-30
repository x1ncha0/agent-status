# Theo dõi Antigravity trong Agent Status — Design

Ngày: 30/09/2026 · Trạng thái: chờ duyệt spec

## Mục tiêu

- Agent Status hiện thêm đèn thứ ba **Antigravity** (Google Antigravity 2.0 và Antigravity IDE), cạnh Claude và Codex, trên cả macOS và Windows.
- Vàng khi agent đang suy nghĩ / chạy tool, xanh khi đã dừng. Đèn tự ẩn khi Antigravity tắt, giống các agent khác.
- Cài hook từ cùng menu **Thiết lập kết nối...**, không làm thay đổi hành vi hay quyền của agent Antigravity.
- Hành vi Claude / Codex không đổi.

## Quyết định đã chốt

| Vấn đề        | Chọn                                                                                      | Lý do                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Phạm vi       | Agent thứ ba trong app hiện có                                                            | Dùng chung cửa sổ, tray, updater, installer                                                                                            |
| Nguồn dữ liệu | Lifecycle hooks của Antigravity (`hooks.json`)                                            | Có tài liệu (nhúng trong `language_server`); không đọc gRPC / state nội bộ                                                             |
| Đèn đỏ        | **Không có** cho Antigravity                                                              | Không có event chờ duyệt; `PreToolUse` bắt buộc trả `decision` và có thể đổi hành vi approval. Chỉ dùng event mà output `{}` là vô hại |
| Vị trí hook   | Global: `~/.gemini/config/hooks.json` (Windows `%USERPROFILE%\.gemini\config\hooks.json`) | "Global Customizations Root", áp dụng cho mọi workspace                                                                                |
| Writer        | Mở rộng writer hiện có (`write-agent-event.js`, `Write-AgentEvent.ps1`)                   | Dùng lại logic tìm owner + ghi file nguyên tử; không nhân đôi code                                                                     |
| Nền tảng      | macOS + Windows                                                                           | Windows được kiểm bằng test trong CI (`windows-latest`); kiểm chứng thật chỉ trên mac                                                  |

## Hợp đồng hook của Antigravity (đã trích từ tài liệu trong binary 2.12.2)

- `hooks.json` là object: mỗi khoá top-level là **tên hook**, giá trị là `{ enabled?, PreToolUse?, PostToolUse?, PreInvocation?, PostInvocation?, Stop? }`. Nhiều tên hook cho cùng event được gộp và chạy tuần tự.
- `PreToolUse` / `PostToolUse` dạng nhóm `{ matcher, hooks: [handler] }`; `PreInvocation` / `PostInvocation` / `Stop` dạng phẳng `[handler]`.
- Handler: `{ type: "command", command, timeout (giây, mặc định 30) }`. Chạy bằng `sh -c` (Unix) / `cmd /c` (Windows), cwd là thư mục chứa `hooks.json`.
- Stdin là JSON camelCase, luôn có `conversationId`, `workspacePaths`, `transcriptPath`, `artifactDirectoryPath`, `modelName`. `Stop` có thêm `terminationReason` (`model_stop`, `max_steps_exceeded`, `error`...), `error`, `fullyIdle`. **Không có tên event trong payload.**
- Stdout phải là JSON. `{}` là trung tính cho `PreInvocation` (không `injectSteps`), `PostToolUse` (yêu cầu `{}`) và `Stop` (`decision` khác `"continue"` → cho dừng).
- Hook chạy đồng bộ, chặn vòng lặp agent → writer phải nhanh; timeout đặt 3 giây như các agent khác.

## Kiến trúc

Không đổi: `StatusStore`, `FileMonitor`, owner probe, auto-hide, attention sound, updater, định dạng file event. `Agent` mở rộng thành `'claude' | 'codex' | 'antigravity'`.

### Cấu hình ghi vào `hooks.json`

Installer sở hữu đúng một khoá `"agent-status"`; mọi khoá khác giữ nguyên thứ tự và nội dung:

```json
{
  "agent-status": {
    "PreInvocation": [{ "type": "command", "command": "<cmd> PreInvocation", "timeout": 3 }],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "<cmd> PostToolUse", "timeout": 3 }]
      }
    ],
    "Stop": [{ "type": "command", "command": "<cmd> Stop", "timeout": 3 }]
  }
}
```

`<cmd>`:

- macOS: `/usr/bin/osascript -l JavaScript "<dataDir>/write-agent-event.js" antigravity "<dataDir>"`
- Windows: `powershell.exe -NoProfile -NonInteractive -File "<dataDir>\Write-AgentEvent.ps1" -Agent antigravity -DataDir "<dataDir>" -Event`

`configured` = khoá `"agent-status"` tồn tại và bằng đúng (deep-equal) cấu hình mong đợi. `enabled: false` do người dùng tự đặt được coi là chưa cấu hình → cài lại sẽ bật lại.

**Chỉ cài khi `~/.gemini` tồn tại** (Antigravity đã từng chạy). Nếu không, Antigravity không có trong `Installation.agents`, không tạo thư mục, không ảnh hưởng `needsInstall`. Override thư mục: biến môi trường `AGENT_STATUS_GEMINI_HOME` (dùng cho test/smoke).

### Writer

Cả hai writer nhận thêm tham số tên event khi `agent = antigravity` (mac: `argv[2]`; Windows: `-Event`):

1. Đọc stdin JSON. Thiếu `conversationId` hoặc tên event không thuộc `PreInvocation|PostToolUse|Stop` → bỏ qua.
2. Record: `agent: "antigravity"`, `session_id: conversationId`, `hook_event_name: <event>`, `timestamp`. Với `Stop`, `terminationReason` được lưu vào field `source` sẵn có (không đổi schema file event). Không lưu `workspacePaths`, `transcriptPath` hay nội dung nào khác.
3. Owner: như hiện tại (đi lên tối đa 8 cấp). Quy tắc khớp cho `antigravity`:
   - mac: `args` khớp `/\/language_server\w*(\s|$)/` **và** chứa `antigravity` (không phân biệt hoa thường). Khớp cả `/Applications/Antigravity.app/Contents/Resources/bin/language_server` và `/Applications/Antigravity IDE.app/.../extensions/antigravity/bin/language_server_macos_arm`. Không tách token theo dấu cách vì đường dẫn `Antigravity IDE.app` có dấu cách.
   - Windows (`ProcessOwner.cs`): tên tiến trình bắt đầu bằng `language_server` và kết thúc `.exe`.
4. **Luôn in `{}` ra stdout rồi exit 0** với `antigravity`, kể cả khi lỗi (in trước khi xử lý, để lỗi giữa chừng không làm hỏng output). Claude/Codex giữ nguyên: không in gì.

### Classifier: `src/monitor/antigravity.ts`

| Event           | Trạng thái | Lý do hiển thị                                                                            |
| --------------- | ---------- | ----------------------------------------------------------------------------------------- |
| `PreInvocation` | working    | Đang suy nghĩ                                                                             |
| `PostToolUse`   | working    | Đang chạy tool                                                                            |
| `Stop`          | available  | `source = error` → "Đã dừng do lỗi"; còn lại → "Đã hoàn thành, sẵn sàng nhận yêu cầu mới" |
| khác            | bỏ qua     |                                                                                           |

Không dùng `commonEvent` (tên event khác hệ Claude/Codex). Không bao giờ trả `stuck`.

Vòng đời phiên: Antigravity không có `SessionEnd`, nên một conversation giữ đèn xanh chừng nào `language_server` còn sống; tắt app → owner chết → đèn ẩn trong một lần poll. Event không có owner (vd antigravity-cli, hoặc không tìm được tiến trình) dùng `OWNERLESS_TTL_MS` sẵn có.

### Main / installer

- `SetupPaths` thêm `geminiHome` (`AGENT_STATUS_GEMINI_HOME` || `~/.gemini`).
- `main.ts`: thêm `FileMonitor(events/antigravity, 'antigravity', classifyAntigravity)`.
- `parseEvent` chấp nhận `agent: 'antigravity'`.
- mac `integration-mac.ts`: thêm plan cho `hooks.json` của Antigravity với hàm merge riêng (thay khoá `agent-status`), cùng quy tắc: parse mọi file trước khi ghi, JSON hỏng → dừng toàn bộ, sao lưu `.agent-status-<uuid>.bak` trước khi ghi.
- Windows `Install-Hooks.ps1`: thêm tham số `-GeminiHome`, cùng logic (dùng `ConvertFrom-Json` / `Add-Member` như phần Claude/Codex; so sánh configured bằng JSON chuẩn hoá của khoá `agent-status`).
- `integration.ts`: tên hiển thị `Antigravity`; tiêu đề "Kết nối với các agent"; hướng dẫn thêm dòng "Antigravity: mở cuộc hội thoại mới rồi gửi một yêu cầu." Thay đổi file bundled → fingerprint đổi → hộp thoại tự đề nghị cài lại ở lần mở đầu sau khi cập nhật (hành vi sẵn có).

### UI

- `index.html`: thêm `<div class="agent" id="antigravity">` với nhãn `Antigravity`.
- `app.ts`: kiểu `AgentView.agent` thêm `antigravity`; hệ số scale chia theo số đèn đang hiện: `min(width / (55 * visible), height / 55)` (2 đèn → 110 như cũ).
- CSS: nhãn `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.
- Kích thước mặc định cho lần đầu: `165 × 55` (đủ ba đèn). Bounds đã lưu giữ nguyên; tối thiểu giữ `90 × 45`.
- Tooltip khay: tên hiển thị `Claude`, `Codex`, `Antigravity` thay vì id thô.

## Xử lý lỗi

- Writer không bao giờ chặn agent: mọi lỗi bị nuốt, stdout luôn `{}`, exit 0; timeout 3 giây.
- `hooks.json` không phải JSON hợp lệ (hoặc không phải object) → cài đặt dừng, không ghi file nào, hộp thoại lỗi nêu đường dẫn (giống Claude/Codex).
- Khoá `agent-status` có sẵn nhưng sai dạng → bị thay hoàn toàn (đó là khoá của app).
- Không tìm được owner → event vẫn ghi, phiên hết hạn theo TTL.
- Người dùng tắt hook bằng `enabled: false` → `check()` báo cần cài; app không tự bật lại nếu người dùng chọn **Để sau**.

## Testing

Tự động (`npm test`, chạy trên cả `macos-latest` và `windows-latest` trong CI):

- `monitor.test.ts`: classifier (từng event, Stop lỗi/không lỗi, event lạ bị bỏ qua, không bao giờ `stuck`); `parseEvent` nhận `antigravity`; `FileMonitor` với nhiều conversation; owner chết → ẩn.
- `integration-mac.test.ts`: cài mới; giữ các hook khác trong `hooks.json`; idempotent; có `.bak`; JSON hỏng → không ghi gì; `~/.gemini` không tồn tại → bỏ qua Antigravity và không tạo thư mục; `enabled: false` → `configured: false`.
- Writer mac (chạy thật qua `osascript`): payload Antigravity → file event có `session_id = conversationId`, `source` từ `terminationReason`, không có field thừa; stdout đúng `{}`; stdin rác → vẫn `{}` và exit 0; owner được nhận khi writer chạy dưới một tiến trình giả tên `language_server` trong đường dẫn chứa `antigravity`.
- Windows (`monitor.test.ts`, phần đã có fixture `HookOwner.cs`): copy fixture thành `language_server_windows_x64.exe` → owner được nhận; `Install-Hooks.ps1 -Check/-Apply` với `-GeminiHome` tạm.
- `tray-tooltip.test.ts`: tên hiển thị mới.
- `scripts/smoke.cjs`: đặt `AGENT_STATUS_GEMINI_HOME` tạm, kiểm tra cài hook Antigravity, gửi event → đèn `#antigravity` vàng rồi xanh, ba đèn cùng hiện không tràn.
- `npm run check` (lint, format, typecheck) sạch.

Kiểm chứng thật trên máy mac này (bắt buộc trước khi báo xong):

1. Sao lưu `~/.gemini/config/hooks.json` (nếu có), cài qua app.
2. Antigravity 2.0: mở conversation mới, gửi yêu cầu có chạy tool → đèn vàng trong lúc chạy, xanh khi xong. Xác nhận hộp thoại xin quyền / hành vi auto-approve không đổi so với trước khi cài.
3. Antigravity IDE: lặp lại bước 2 (xác nhận IDE cũng đọc hook global).
4. Thoát Antigravity → đèn ẩn trong vài giây.
5. Ghi lại: có cần khởi động lại app để hook mới có hiệu lực không → đưa vào hướng dẫn trong hộp thoại/README.

Nếu bước 3 cho thấy IDE không đọc `~/.gemini/config/hooks.json`: dừng lại, báo kết quả và đề xuất phương án (không tự mở rộng phạm vi).

## Tài liệu

- README: thêm Antigravity vào mô tả, bảng trạng thái ghi chú "Antigravity không có đèn đỏ", mục cài đặt nêu `~/.gemini/config/hooks.json`.
- `RELEASE_NOTES.md`: mục bản kế tiếp (1.3.0). Việc bump version / tag để lúc release.

## Ngoài phạm vi

- Đèn đỏ cho Antigravity (cần `PreToolUse`; có thể xem lại khi Antigravity có event chờ duyệt).
- Owner cho antigravity-cli (chỉ chạy theo TTL).
- Hook theo workspace (`.agents/hooks.json`).
- Linux.
