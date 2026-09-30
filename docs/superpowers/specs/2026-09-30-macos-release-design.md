# Agent Status cho macOS + release tự động — Design

Ngày: 30/09/2026 · Trạng thái: đã duyệt hướng, chờ plan

## Mục tiêu

- Người dùng Claude Code / Codex CLI trên macOS có trải nghiệm tương đương bản Windows: đèn xanh/vàng/đỏ, tiếng báo khi chuyển đỏ, cửa sổ nổi tự ẩn/hiện theo phiên, cài hook từ menu, kiểm tra cập nhật, mở cùng hệ thống.
- Mỗi lần push tag `vX.Y.Z`, GitHub Actions build bản Windows (`AgentStatus.exe`) và macOS (`.dmg` arm64 + x64) kèm SHA256, rồi đăng GitHub Release.
- Bản Windows hiện tại không đổi hành vi.

## Quyết định đã chốt

| Vấn đề            | Chọn                                                      | Lý do                                                                                                                                        |
| ----------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Build mac ở đâu   | GitHub Actions `macos-latest`                             | Máy dev là Windows; electron-builder không build `.app` từ Windows                                                                           |
| Ký số             | Không có Apple Developer ID; chỉ ad-hoc signature         | Giống bản Windows (chưa ký). README hướng dẫn mở lần đầu                                                                                     |
| Cập nhật trên mac | Tải `.dmg` vào Downloads, kiểm SHA256, mở Finder          | App chưa ký; không tự thay bundle                                                                                                            |
| Hook writer mac   | Script JXA (`osascript -l JavaScript`) có sẵn trong macOS | Không phụ thuộc Node/Python; parse JSON đầy đủ (kể cả `null`, mà `plutil` không đọc được); chép vào data dir nên không gãy khi di chuyển app |
| Installer mac     | TypeScript trong main process                             | Test được bằng `node --test`; Windows giữ nguyên `Install-Hooks.ps1`                                                                         |
| Kiến trúc CPU     | Hai file `.dmg` riêng: arm64, x64                         | Universal gấp đôi dung lượng; updater chọn theo `process.arch`                                                                               |

## Kiến trúc

Không đổi: `src/monitor/*` (trừ `process-owner.ts`), renderer, `window-state`, `attention`, `tray-tooltip`, `update-release`, định dạng file event (`<dataDir>/events/<agent>/<uuid>.json` với `agent`, `session_id`, `hook_event_name`, `timestamp`, tuỳ chọn `tool_name`, `tool_use_id`, `notification_type`, `source`, `owner_pid`, `owner_started_at`).

Điểm phụ thuộc nền tảng:

| Chỗ                     | Windows (giữ nguyên)         | macOS (mới)                                                                 |
| ----------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Data dir                | `%LOCALAPPDATA%\AgentStatus` | `~/Library/Application Support/AgentStatus` (`app.getPath('appData')`)      |
| `processStartTime(pid)` | PowerShell `Get-Process`     | `/bin/ps -o lstart= -p <pid>` với `LC_ALL=C`                                |
| Integration backend     | `Install-Hooks.ps1`          | `src/main/integration-mac.ts` + `integration/mac/write-agent-event.js`      |
| Updater                 | thay exe portable            | tải `.dmg`, reveal trong Finder                                             |
| Mở cùng hệ thống        | "Start with Windows"         | "Start at login" (`setLoginItemSettings({ openAtLogin })`)                  |
| Cửa sổ / tray           | như cũ                       | không có icon Dock (`LSUIElement`), hiện trên mọi Space, icon menu bar 18px |

`AGENT_STATUS_DATA_DIR` vẫn override data dir trên cả hai nền tảng.

### `src/common/platform.ts` (mới)

- `isMac = process.platform === 'darwin'`, `isWindows = process.platform === 'win32'`.
- `defaultDataDir(appData: string): string`: Windows dùng `LOCALAPPDATA` (fallback `appData`), mac dùng `appData`; cả hai nối thêm `AgentStatus`.
- `POWERSHELL` giữ trong `src/common/powershell.ts`.

## Hook writer macOS: `integration/mac/write-agent-event.js`

Lệnh hook (một dòng, đường dẫn luôn được đặt trong ngoặc kép vì có dấu cách trong `Application Support`):

```
/usr/bin/osascript -l JavaScript "<dataDir>/write-agent-event.js" <agent> "<dataDir>"
```

Hành vi (tương đương `Write-AgentEvent.ps1`):

1. `function run(argv)`: `argv[0]` là `claude|codex` (giá trị khác thì thoát), `argv[1]` là data dir.
2. Đọc toàn bộ stdin qua `$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile`, decode UTF-8, `JSON.parse`.
3. Thiếu `session_id` hoặc `hook_event_name` thì thoát. Chỉ copy các field ở trên dưới dạng string. **Không ghi** prompt, `tool_input` hay `tool_response`.
4. Tìm owner: gọi **một lần** `/bin/ps -A -o pid=,ppid=,lstart=,args=` (env `LC_ALL=C`) qua `$.NSTask`, dựng map pid → {ppid, lstart, args}. Đi từ pid của chính `osascript` (`$.NSProcessInfo.processInfo.processIdentifier`) lên tối đa 8 cấp:
   - Tiến trình khớp khi basename của token đầu `args` bằng `agent`. Với `claude`: khớp thêm nếu `args` chứa `claude-code` (bản cài qua npm chạy bằng `node`) hoặc chứa `/claude/versions/` (bản native dạng symlink).
   - Khi khớp: `owner_pid = pid`, `owner_started_at` = epoch ms của `lstart`, parse tường minh bằng regex `^\w{3} (\w{3}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4})$` (tên tháng tiếng Anh, `new Date(y, m, d, h, mi, s)` theo giờ local, ngày một chữ số có hai dấu cách). Không dùng `Date.parse`. Độ chính xác đến giây.
   - Có lỗi thì bỏ qua owner, vẫn ghi event.
5. Tạo `<dataDir>/events/<agent>/` nếu chưa có. Ghi `<uuid>.tmp` rồi `moveItemAtPath` sang `<uuid>.json` (UUID lấy từ `$.NSUUID`).
6. Mọi lỗi bị nuốt. `run` không return giá trị nào nên stdout **trống** (Claude đưa stdout của một số hook vào context). Exit code luôn là 0.

Ghi chú: `processStartTime` phía app cũng dùng `ps lstart`, nên hai giá trị bằng nhau tuyệt đối và dung sai `< 10 ms` của `createOwnerProbe` vẫn đúng.

## Installer macOS: `src/main/integration-mac.ts`

Là hàm thuần nhận `{ dataDir, integrationDir, claudeHome, codexHome }` và dùng `fs/promises`. Port 1:1 từ `Install-Hooks.ps1`:

- Events chung: `SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, Stop`. Claude thêm `PostToolUseFailure, StopFailure, Notification, Elicitation, ElicitationResult`. Codex thêm `Interrupt`.
- File đích: `<claudeHome>/settings.json` và `<codexHome>/hooks.json`. File chưa có thì coi là `{}`. JSON lỗi thì **throw** (không ghi đè).
- Handler "của mình" là handler có `command` chứa `write-agent-event.js` và token agent tương ứng. Với mỗi event: xoá handler của mình khỏi mọi group, bỏ group rỗng, giữ nguyên các hook khác, rồi thêm `{ hooks: [{ type: 'command', command, timeout: 3 }] }`.
- `configured` cho một agent chỉ khi mọi event đều đã có đúng `command`, `type: 'command'`, và matcher rỗng hoặc `'*'`.
- `check()` trả `{ needsInstall, writerCurrent, agents }` giống output `-Check`. `writerCurrent` là SHA256 của `<dataDir>/write-agent-event.js` bằng SHA256 của bản trong bundle.
- `apply()`: tạo data dir, copy writer, backup file đích thành `<file>.agent-status-<uuid>.bak`, ghi JSON (indent 2, UTF-8 không BOM).

`src/main/integration.ts` nhận một backend `{ check(), apply(), files: string[] }`. `files` dùng để tính fingerprint "để sau". Windows backend bọc lệnh PowerShell hiện tại. Bỏ điều kiện `process.platform !== 'win32'`; nền tảng khác mac/Windows thì không có backend nên `show` return. Hướng dẫn `nextSteps` đổi tên file theo nền tảng (`Write-AgentEvent.ps1` / `write-agent-event.js`).

## Process owner: `src/monitor/process-owner.ts`

- `processStartTime` trên mac: `execFile('/bin/ps', ['-o', 'lstart=', '-p', pid], { env: { ...process.env, LC_ALL: 'C' } })`. Output rỗng thì trả 0.
- Tách hàm thuần `parseLstart(text): number` dùng đúng regex và quy tắc như writer (vd. `Tue Sep 30 10:11:12 2026`, `Wed Oct  1 09:00:00 2026` → epoch ms theo giờ local; không khớp hoặc rỗng → 0), để test chạy được trên mọi OS.

## Cửa sổ, tray, mở cùng hệ thống (mac)

- `build.mac.extendInfo.LSUIElement = true`: không có icon Dock, không nhảy trong app switcher.
- `window.ts`: trên mac gọi `win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`. Giữ `setAlwaysOnTop(true, 'floating')`.
- `tray.ts`: icon resize 18×18 trên mac (16×16 trên Windows), dùng icon màu hiện có (chưa làm template image). Menu item mở cùng hệ thống có nhãn `Start with Windows` hoặc `Start at login` và bật khi `app.isPackaged && (isWindows || isMac)`. Trên mac gọi `setLoginItemSettings({ openAtLogin })`, không truyền `path`.
- `shell.beep()` và `window-all-closed → quit` giữ nguyên.

## Updater (mac)

- Asset: `AgentStatus-mac-${process.arch}.dmg` (`arm64` | `x64`) + `AgentStatus-mac-${arch}.dmg.sha256`. Windows vẫn là `AgentStatus.exe`.
- Luồng giữ nguyên (check → available → downloading → verify SHA256). Trên mac luôn lưu vào `Downloads/AgentStatus-<version>-mac-<arch>.dmg` và kết thúc ở phase `downloaded`, message: `Đã lưu <file> vào Downloads. Thoát Agent Status, mở file .dmg rồi kéo Agent Status vào Applications để thay bản cũ.` Nút **Mở thư mục** reveal file.
- `cleanupPreviousUpdate` không làm gì trên mac.
- `ASSET` thành hàm `updateAsset(platform, arch)` đặt trong `update-release.ts` và có test.

## Đóng gói

`package.json`:

- Scripts: `dist:win` (lệnh `dist` hiện tại), `dist:mac` (`npm run build && electron-builder --mac dmg --arm64 --x64 && node scripts/package-files.cjs`). `dist` giữ làm alias của `dist:win`.
- `build.mac`: `target: dmg`, `category: public.app-category.developer-tools`, `icon: assets/icon-mac.png`, `identity: "-"` (ad-hoc), `extendInfo.LSUIElement: true`. `build.dmg.artifactName: AgentStatus-mac-${arch}.${ext}`.
- `assets/icon-mac.png`: 1024×1024, upscale từ `assets/icon.png` (electron-builder yêu cầu tối thiểu 512 px) và commit vào repo.
- `extraResources` giữ `integration` → trên mac nằm ở `Contents/Resources/integration/mac/write-agent-event.js`.

`scripts/package-files.cjs` tạo `<file>.sha256` (`<hex>  <name>`) cho mọi file `release/AgentStatus.exe` và `release/AgentStatus-mac-*.dmg` đang có, rồi copy `integration/`, README và RELEASE_NOTES như hiện tại.

## CI: `.github/workflows/release.yml`

Trigger: `push` tag `v*`, `pull_request`, `workflow_dispatch`.

- `windows` (`windows-latest`): `npm ci` → `npm run check` → `npm test` → `npm run dist:win` → upload artifact `AgentStatus.exe` + `.sha256`.
- `mac` (`macos-latest`): `npm ci` → `npm run check` → `npm test` → `node --test`-style test chạy writer JXA thật (xem Testing) → `npm run dist:mac` → `codesign --verify --deep` mỗi `.app` → upload artifact các `.dmg` + `.sha256`.
- `release` (chỉ khi ref là tag, `needs: [windows, mac]`, `permissions: contents: write`): kiểm tag bằng `v` + `package.json.version`, trích mục version tương ứng trong `RELEASE_NOTES.md` làm notes, chạy `gh release create <tag> <files…> --notes-file …`.
- `CSC_IDENTITY_AUTO_DISCOVERY=false` cho job mac để electron-builder không tìm cert.

## README / Release notes

- README: thêm badge macOS và nút tải `AgentStatus-mac-arm64.dmg` (Apple Silicon) / `-x64.dmg` (Intel). Mục "Mở lần đầu trên macOS": chuột phải → Open, hoặc `xattr -dr com.apple.quarantine "/Applications/Agent Status.app"`. Ghi data dir mac. Cập nhật mục Giới hạn.
- RELEASE_NOTES: mục `1.2.0` mô tả bản macOS và release tự động. Version trong `package.json` thành `1.2.0`.

## Xử lý lỗi

- Hook writer: mọi lỗi đều im lặng, exit 0, stdout trống. Không bao giờ chặn agent.
- Installer: JSON lỗi hoặc không ghi được thì throw, `integration.ts` hiện dialog lỗi như hiện tại. File gốc chỉ bị ghi sau khi đã backup.
- `processStartTime` lỗi: `createOwnerProbe` đã coi owner là còn sống và kiểm lại ở lần poll sau (không đổi).
- Updater mac: checksum thiếu hoặc lệch thì xoá file tải về, báo lỗi (không đổi).

## Testing

- Test hiện có dùng `powershell.exe` hoặc `HookOwner.cs` được đánh dấu `{ skip: process.platform !== 'win32' }`, để `npm test` pass trên mac.
- Unit test mới (chạy mọi OS): `parseLstart`, `defaultDataDir`, `updateAsset`, installer mac trên thư mục tạm (cài mới; giữ hook khác; cài lại idempotent; bỏ handler cũ khi đường dẫn đổi; JSON lỗi → throw, file không đổi; `check` trước/sau `apply`; tạo `.bak`).
- Test chỉ chạy trên darwin: gọi `/usr/bin/osascript -l JavaScript integration/mac/write-agent-event.js claude <tmp>` với stdin là payload mẫu có `null`, có `tool_input` lớn và có prompt. Assert: exit 0, stdout rỗng, đúng một file `.json`, field đúng, không chứa prompt hay `tool_input`. Payload thiếu `session_id` thì không có file. Test owner: chạy writer qua một wrapper tên `claude` (symlink `/bin/sh` đặt tên `claude` trong thư mục tạm, chạy `-c '<osascript …>; true'`: có lệnh `true` ở cuối để sh không `exec` thay thế chính nó) và assert `owner_pid` là pid của wrapper, `owner_started_at` bằng `parseLstart` của nó.
- CI mac là nơi kiểm chứng duy nhất cho phần darwin. Chạy thử bằng tay trên Mac thật (mở `.dmg`, cài hook, chạy claude) là việc của người phát hành trước khi công bố.

## Ngoài phạm vi

- Ký bằng Developer ID / notarize, tự thay `.app` khi cập nhật.
- Icon template đơn sắc cho menu bar.
- Linux.
- Chuyển installer Windows sang TypeScript.
