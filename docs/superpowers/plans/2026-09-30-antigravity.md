# Antigravity Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm đèn thứ ba "Antigravity" (xanh/vàng) vào Agent Status trên macOS và Windows, lấy trạng thái qua lifecycle hooks global của Antigravity.

**Architecture:** Writer hiện có (`write-agent-event.js`, `Write-AgentEvent.ps1`) có thêm chế độ `antigravity`: nhận tên event qua tham số, đổi `conversationId` → `session_id`, luôn in `{}`. Installer ghi khoá `"agent-status"` vào `~/.gemini/config/hooks.json`. Monitor dùng `FileMonitor` + classifier mới; renderer thêm một ô đèn.

**Tech Stack:** TypeScript, Electron, node:test, JXA (osascript), PowerShell 5.1, C# (Add-Type).

**Spec:** `docs/superpowers/specs/2026-09-30-antigravity-design.md`

## Global Constraints

- Agent id: `antigravity`; tên hiển thị: `Antigravity`.
- Events đăng ký: chỉ `PreInvocation`, `PostToolUse` (matcher `"*"`), `Stop`. Không đăng ký `PreToolUse`. Timeout `3`.
- Khoá sở hữu trong hooks.json: `"agent-status"`; các khoá khác giữ nguyên.
- Global hooks file: `<geminiHome>/config/hooks.json`, `geminiHome` = `AGENT_STATUS_GEMINI_HOME` || `~/.gemini`. Chỉ cài khi `geminiHome` tồn tại.
- Writer antigravity: luôn in đúng `{}` ra stdout, exit 0. Claude/Codex: không in gì (không đổi).
- Record antigravity chỉ gồm `agent`, `session_id` (= `conversationId`), `hook_event_name`, `timestamp`, tuỳ chọn `source` (= `terminationReason` của Stop), `owner_pid`, `owner_started_at`.
- Classifier không bao giờ trả `stuck`.
- Kích thước mặc định lần đầu `165 × 55`; tối thiểu `90 × 45` giữ nguyên.
- Chuỗi hiển thị tiếng Việt như spec.

## Review Focus

- `hooks.json` có khoá `agent-status` do người dùng tắt (`enabled: false`) → `configured: false` (test ở Task 3).
- Payload Antigravity không phải JSON / thiếu `conversationId` → vẫn in `{}`, không ghi file (Task 2, Task 4).
- Đường dẫn owner có dấu cách (`Antigravity IDE.app`) → vẫn nhận owner (Task 2).
- Máy không có `~/.gemini` → không tạo thư mục, Antigravity không có trong `agents` (Task 3, Task 4).
- Tên event lạ truyền vào writer (vd `PreToolUse`) → bỏ qua, vẫn `{}` (Task 2).

---

### Task 1: Agent type, classifier, parseEvent, tooltip

**Files:**

- Create: `src/monitor/antigravity.ts`
- Modify: `src/monitor/status.ts` (type `Agent`), `src/monitor/file-monitor.ts` (`parseEvent`), `src/main/tray-tooltip.ts`
- Test: `src/tests/monitor.test.ts`, `src/tests/tray-tooltip.test.ts`

**Interfaces:**

- Produces: `export type Agent = 'claude' | 'codex' | 'antigravity'`; `export const classifyAntigravity: Classifier`; `export const AGENT_NAMES: Record<Agent, string>` trong `status.ts` = `{ claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' }`.

- [ ] **Step 1: Tests** — `antigravity: PreInvocation/PostToolUse working, Stop available` (StatusStore với `classifyAntigravity`: PreInvocation → working reason `Đang suy nghĩ`; PostToolUse → working `Đang chạy tool`; Stop → available `Đã hoàn thành, sẵn sàng nhận yêu cầu mới`; Stop với `source: 'error'` → available `Đã dừng do lỗi`; `PreToolUse`/`PermissionRequest`/`SessionEnd` → `undefined`); `parseEvent accepts antigravity` (`agent: 'antigravity'` trả về event; `agent: 'gemini'` trả `undefined`). Tooltip: kỳ vọng đổi thành `Claude: …`, `Codex: …`, thêm case `Antigravity: Đang suy nghĩ / làm việc`.
- [ ] **Step 2:** `npm test` → FAIL (module không tồn tại / chuỗi tooltip khác).
- [ ] **Step 3:** Implement: `classifyAntigravity` theo bảng; `parseEvent` dùng danh sách agent hợp lệ từ `AGENT_NAMES`; tooltip dùng `AGENT_NAMES[state.agent]`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add Antigravity status classifier`.

### Task 2: macOS writer — chế độ antigravity

**Files:**

- Modify: `integration/mac/write-agent-event.js`
- Test: `src/tests/integration-mac.test.ts`

**Interfaces:**

- Produces: CLI `osascript -l JavaScript write-agent-event.js antigravity <dataDir> <Event>`, `Event ∈ {PreInvocation, PostToolUse, Stop}`.

- [ ] **Step 1: Tests (macOnly)**
  - `JXA writer maps Antigravity payload and prints {}`: input `{conversationId:'conv-1', workspacePaths:['/SECRET'], transcriptPath:'/SECRET/t.jsonl', terminationReason:'model_stop', fullyIdle:true}` với event `Stop` → `stdout === '{}'`, status 0; record `{agent:'antigravity', session_id:'conv-1', hook_event_name:'Stop', source:'model_stop'}` + timestamp; file không chứa `SECRET`.
  - `JXA writer prints {} for bad Antigravity input`: các case `'not json'`, `{}` (thiếu conversationId), event `PreToolUse`, thiếu tham số event → `stdout === '{}'`, status 0, không có `events/`.
  - `JXA writer finds the Antigravity language server owner`: tạo thư mục `.../Antigravity IDE.app/bin/`, symlink `/bin/bash` thành `language_server_macos_arm`, chạy như test owner Claude với args `antigravity <dataDir> PreInvocation` → `owner_pid` = pid shell.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement: nếu `argv[0] === 'antigravity'` thì in `{}` ngay đầu `run` (dùng `$.NSFileHandle.fileHandleWithStandardOutput.writeData`), chỉ chấp nhận ba event, lấy `session_id` từ `conversationId`, `source` từ `terminationReason` (chỉ khi Stop), không copy `FIELDS`. `matches('antigravity', args)`: `/\/language_server\w*(\s|$)/.test(args) && /antigravity/i.test(args)`.
- [ ] **Step 4:** `npm test` → PASS (các test JXA Claude/Codex cũ vẫn `stdout === ''`).
- [ ] **Step 5:** Commit `feat: record Antigravity hook events on macOS`.

### Task 3: macOS installer + wiring

**Files:**

- Modify: `src/main/integration-backend.ts` (`SetupPaths.geminiHome`), `src/main/integration-mac.ts`, `src/main/main.ts`
- Test: `src/tests/integration-mac.test.ts`

**Interfaces:**

- Consumes: `Agent`, `classifyAntigravity` (Task 1).
- Produces: `SetupPaths.geminiHome: string`; `export function antigravityHooks(command: string): object` (khoá `agent-status` mong đợi, `command` là `<cmd>` chưa có tên event); `macHookCommand('antigravity', dataDir)` như các agent khác.

- [ ] **Step 1: Tests** (setup thêm `geminiHome: path.join(root, '.gemini')`)
  - Test fresh install cũ: không tạo `.gemini` → `agents` vẫn chỉ `[claude, codex]`, `.gemini` không bị tạo.
  - `mac installer: Antigravity hooks keep other named hooks`: tạo `.gemini/config/hooks.json` `{ "lint": { "Stop": [{ "command": "echo lint" }] } }` → check `configured:false` → apply → `lint` giữ nguyên, `agent-status` deep-equal `antigravityHooks(macHookCommand('antigravity', dataDir))`, có `.bak`, check `configured:true`; apply lại không đổi file.
  - `.gemini` tồn tại nhưng chưa có `config/` → apply tạo `config/hooks.json`.
  - `enabled: false` trong `agent-status` → `configured:false`.
  - `hooks.json` hỏng → check/apply reject với `/hooks\.json/`, không file nào bị ghi.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement: `antigravityHooks(cmd)` trả `{ PreInvocation: [{type:'command', command:`${cmd} PreInvocation`, timeout:3}], PostToolUse: [{matcher:'*', hooks:[{type:'command', command:`${cmd} PostToolUse`, timeout:3}]}], Stop: [...] }`. Plan antigravity chỉ khi `stat(geminiHome)` là thư mục; configured = `isDeepStrictEqual(settings['agent-status'], expected)`; merge = `{ ...settings, 'agent-status': expected }`. `main.ts`: thêm `geminiHome` và `FileMonitor(events/antigravity, 'antigravity', classifyAntigravity)`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: install Antigravity hooks on macOS`.

### Task 4: Windows writer, owner, installer

**Files:**

- Modify: `integration/Write-AgentEvent.ps1`, `integration/ProcessOwner.cs`, `integration/Install-Hooks.ps1`, `src/main/integration-backend.ts` (`-GeminiHome`), `src/tests/fixtures/HookOwner.cs` (tham số thứ 4 tuỳ chọn → `-HookEvent`)
- Test: `src/tests/monitor.test.ts` (windowsOnly)

**Interfaces:**

- Produces: `Write-AgentEvent.ps1 -Agent antigravity -DataDir <d> -HookEvent <E>`; `Install-Hooks.ps1 -GeminiHome <path>`; `Check` JSON thêm `{agent:'antigravity', configured}` khi `GeminiHome` tồn tại.

- [ ] **Step 1: Tests (windowsOnly)**
  - `Windows writer and installer handle Antigravity`: tạo `gemini/` rỗng, `-Apply` với `-GeminiHome` → `gemini/config/hooks.json` có `agent-status` với ba event, command chứa `-Agent antigravity` và kết thúc bằng tên event; `-Check` → antigravity `configured:true`. Copy fixture thành `language_server_windows_x64.exe`, chạy với args `[writer, data, 'antigravity', 'PostToolUse']`, input `{conversationId:'conv-1'}` → stdout dòng cuối `{}`, record `session_id:'conv-1'`, `owner_pid` = pid fixture. Input `not json` → stdout `{}`, không file mới.
  - Test installer hiện có: không có `-GeminiHome` thư mục → agents chỉ claude/codex.
- [ ] **Step 2:** Không chạy được trên mac; xác nhận test bị skip (`npm test` báo skipped) — sẽ chạy ở CI `windows-latest`.
- [ ] **Step 3:** Implement: `ValidateSet('claude','codex','antigravity')`, param `[string]$HookEvent`; nhánh antigravity `[Console]::Out.Write('{}')` đầu tiên, rồi map như mac. `ProcessOwner.Find`: `agent == "antigravity"` khớp khi `entry.Name` bắt đầu `language_server` (OrdinalIgnoreCase) và kết thúc `.exe`. Installer: plan thêm khi `Test-Path -PathType Container $GeminiHome`; configured bằng so sánh `ConvertTo-Json -Depth 20 -Compress` của khoá `agent-status` với mong đợi; ghi bằng `Add-Member -Force`. Backend TS truyền `-GeminiHome`.
- [ ] **Step 4:** `npm test` (mac) → PASS, test Windows skipped; `npm run check` sạch.
- [ ] **Step 5:** Commit `feat: record and install Antigravity hooks on Windows`.

### Task 5: UI, setup dialog, smoke

**Files:**

- Modify: `src/renderer/index.html`, `src/renderer/app.ts`, `src/renderer/style.css`, `src/main/window-state.ts` (`DEFAULT_SIZE = { width: 165, height: 55 }`), `src/main/integration.ts`, `scripts/smoke.cjs`
- Test: `src/tests/window-state.test.ts`

- [ ] **Step 1: Tests** — `window-state.test.ts`: không có bounds lưu → width `165`, height `55`. Smoke: kỳ vọng `[165, 55]`, message `'Kết nối với các agent'`, `AGENT_STATUS_GEMINI_HOME` tạm (tạo sẵn thư mục) → sau cài có `config/hooks.json`; gửi `PreInvocation` rồi `Stop` cho `antigravity` → `#antigravity .dot` `working` rồi `available`; ba đèn hiện cùng lúc.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement: div `#antigravity` sau `#codex`; `AgentView.agent` thêm `'antigravity'`; aria-label dùng tên hiển thị; scale `Math.max(1, Math.min(width / (55 * Math.max(2, visible)), height / 55))` với `visible` = số `.agent` không hidden, tính lại sau render; nhãn `span` ellipsis. Dialog: tên `Antigravity`, message `'Kết nối với các agent'`, `nextSteps` thêm `'Antigravity: mở cuộc hội thoại mới rồi gửi một yêu cầu.'`, mô tả cài nhắc cấu hình Antigravity.
- [ ] **Step 4:** `npm test` và `npm run check` → PASS. (Smoke chỉ chạy trên Windows.)
- [ ] **Step 5:** Commit `feat: show Antigravity indicator`.

### Task 6: Docs + kiểm chứng thật trên mac

**Files:**

- Modify: `README.md`, `RELEASE_NOTES.md`

- [ ] **Step 1:** README/Release notes theo mục "Tài liệu" của spec.
- [ ] **Step 2:** `npm run build`, chạy app (`npx electron .`), cài kết nối, kiểm chứng 5 bước của spec với Antigravity 2.0 và IDE; ghi kết quả (có cần restart Antigravity không) vào README.
- [ ] **Step 3:** Commit `docs: document Antigravity support`.
