# Agent Status for macOS + Release Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a macOS build of Agent Status (unsigned `.dmg`, arm64 + x64) with feature parity to Windows, and a GitHub Actions workflow that builds both platforms and publishes a GitHub Release on tag push.

**Architecture:** Shared monitor/renderer code stays untouched. OS-specific points (data dir, process start time, integration installer + hook writer, updater, login item, window/tray details) are split behind small functions. The macOS hook writer is a JXA script run by `/usr/bin/osascript`; the macOS installer is TypeScript. Windows keeps its PowerShell installer behind the same backend interface.

**Tech Stack:** Electron 44, TypeScript 5.9 (Node16 modules), `node:test`, electron-builder 26, JXA (JavaScript for Automation), GitHub Actions (`windows-latest`, `macos-latest`), `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-09-30-macos-release-design.md`

## Global Constraints

- Windows behaviour must not change: same hook command, same `Install-Hooks.ps1`, same `AgentStatus.exe` asset and self-replace updater.
- Event file format unchanged: `<dataDir>/events/<agent>/<uuid>.json`; fields `agent, session_id, hook_event_name, timestamp` plus optional string `tool_name, tool_use_id, notification_type, source` and integer `owner_pid, owner_started_at`. Never write prompt, `tool_input`, or `tool_response`.
- macOS data dir: `~/Library/Application Support/AgentStatus` (`app.getPath('appData')` + `AgentStatus`); `AGENT_STATUS_DATA_DIR` overrides on every platform.
- macOS hook command, exactly: `/usr/bin/osascript -l JavaScript "<dataDir>/write-agent-event.js" <agent> "<dataDir>"`, `type: 'command'`, `timeout: 3`.
- The hook writer: stdout empty, exit code 0, all errors swallowed.
- macOS release assets: `AgentStatus-mac-arm64.dmg`, `AgentStatus-mac-x64.dmg`, each with `<name>.sha256` containing `<hex>  <name>\n`.
- User-facing strings are Vietnamese, matching existing copy style.
- New version: `1.2.0`.
- Code must pass `npm run check` (eslint with `--max-warnings 0`, prettier, tsc) and `npm test` on both Windows and macOS.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (plan authored with Claude) — keep the repo's conventional-commit style (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).

## Review Focus

1. **Hook payload containing `null` or very large `tool_response`** — writer must still write the event and not echo anything; pinned by the darwin writer test in Task 4 (payload includes `null` and a 2 MB string).
2. **User's `settings.json` is malformed JSON** — installer must throw and leave the file byte-identical; pinned in Task 3.
3. **Data dir path containing spaces (`Application Support`)** — hook command must quote paths and the writer must work there; the darwin writer test in Task 4 uses a temp dir with a space in its name.
4. **Single-digit day in `ps lstart` (`Wed Oct  1 09:00:00 2026`, two spaces)** — must parse; pinned in Task 1 and reused by the writer.
5. **Reinstall after the data dir moved / old handler with a different path** — installer must replace the stale handler instead of duplicating; pinned in Task 3.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/common/platform.ts` (new) | `isMac`, `isWindows`, `defaultDataDir()` |
| `src/monitor/process-owner.ts` (modify) | add `parseLstart`, darwin branch of `processStartTime` |
| `src/main/update-release.ts` (modify) | add `updateAsset(platform, arch)` |
| `src/main/updater.ts` (modify) | use `updateAsset`; mac always saves to Downloads |
| `src/main/integration-backend.ts` (new) | `Installation`, `IntegrationBackend` types, `createWindowsBackend()` |
| `src/main/integration-mac.ts` (new) | pure macOS installer: `createMacBackend()`, `macHookCommand()` |
| `src/main/integration.ts` (modify) | dialog flow, now driven by an `IntegrationBackend` |
| `integration/mac/write-agent-event.js` (new) | JXA hook writer |
| `src/main/window.ts`, `src/main/tray.ts`, `src/main/main.ts` (modify) | mac window/tray/login-item wiring, backend selection |
| `src/tests/platform.test.ts` (new) | `defaultDataDir`, `parseLstart`, `updateAsset` |
| `src/tests/integration-mac.test.ts` (new) | installer + real JXA writer (darwin-only part) |
| `src/tests/monitor.test.ts` (modify) | skip PowerShell tests off Windows |
| `eslint.config.mjs` (modify) | JXA globals for `integration/mac/*.js` |
| `package.json`, `assets/icon-mac.png`, `scripts/package-files.cjs` | packaging |
| `.github/workflows/release.yml` (new) | CI build + release |
| `README.md`, `RELEASE_NOTES.md` | docs |

---

### Task 1: Platform helpers, `parseLstart`, macOS `processStartTime`, skip Windows-only tests

**Files:**
- Create: `src/common/platform.ts`
- Modify: `src/monitor/process-owner.ts`
- Modify: `src/tests/monitor.test.ts` (tests at lines 134, 293, 374, 456)
- Test: `src/tests/platform.test.ts`

**Interfaces:**
- Produces: `isMac: boolean`, `isWindows: boolean`, `defaultDataDir(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, appData: string): string`, `parseLstart(text: string): number` (exported from `src/monitor/process-owner.ts`).

- [ ] **Step 1: Write the failing test** — `src/tests/platform.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultDataDir } from '../common/platform';

test('data dir follows the platform convention and honours the override', () => {
  assert.equal(
    defaultDataDir('win32', { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'C:\\Roaming'),
    path.join('C:\\Users\\a\\AppData\\Local', 'AgentStatus'),
  );
  assert.equal(defaultDataDir('win32', {}, '/roaming'), path.join('/roaming', 'AgentStatus'));
  assert.equal(
    defaultDataDir('darwin', { LOCALAPPDATA: 'ignored' }, '/Users/a/Library/Application Support'),
    path.join('/Users/a/Library/Application Support', 'AgentStatus'),
  );
  assert.equal(
    defaultDataDir('darwin', { AGENT_STATUS_DATA_DIR: '/custom' }, '/x'),
    '/custom',
  );
});

test('ps lstart output parses as local time, including single-digit days', () => {
  assert.equal(parseLstart('Tue Sep 30 10:11:12 2026'), new Date(2026, 8, 30, 10, 11, 12).getTime());
  assert.equal(parseLstart('  Wed Oct  1 09:00:00 2026\n'), new Date(2026, 9, 1, 9, 0, 0).getTime());
  assert.equal(parseLstart(''), 0);
  assert.equal(parseLstart('garbage'), 0);
  assert.equal(parseLstart('Tue Xyz 30 10:11:12 2026'), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build` — Expected: FAIL, tsc error `Cannot find module '../common/platform'`.

- [ ] **Step 3: Implement** — `src/common/platform.ts`

```ts
import path from 'node:path';

export const isMac = process.platform === 'darwin';
export const isWindows = process.platform === 'win32';

/** Windows keeps data in LOCALAPPDATA; macOS in ~/Library/Application Support. */
export function defaultDataDir(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  appData: string,
): string {
  if (env.AGENT_STATUS_DATA_DIR) return env.AGENT_STATUS_DATA_DIR;
  const base = platform === 'win32' ? env.LOCALAPPDATA || appData : appData;
  return path.join(base, 'AgentStatus');
}
```

In `src/monitor/process-owner.ts` add (after `isRunning`), and change `processStartTime`:

```ts
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `ps -o lstart=` with LC_ALL=C, e.g. "Wed Oct  1 09:00:00 2026", as local-time epoch ms. */
export function parseLstart(text: string): number {
  const match = /^\w{3} (\w{3}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4})$/.exec(text.trim());
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  if (!match || month < 0) return 0;
  const [, , day, hour, minute, second, year] = match.map(Number);
  return new Date(year, month, day, hour, minute, second).getTime();
}

export function processStartTime(pid: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const done = (error: Error | null, stdout: string, parse: (text: string) => number) => {
      if (error) reject(error);
      else resolve(parse(stdout));
    };
    if (process.platform === 'darwin') {
      execFile(
        '/bin/ps',
        ['-o', 'lstart=', '-p', String(pid)],
        { env: { ...process.env, LC_ALL: 'C' }, timeout: 3000 },
        // ps exits 1 with no output when the PID is gone: report 0 like the Windows branch.
        (_error, stdout) => resolve(parseLstart(stdout)),
      );
      return;
    }
    execFile(
      POWERSHELL,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { ([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() } else { 0 }`,
      ],
      { windowsHide: true, timeout: 3000 },
      (error, stdout) => done(error, stdout, (text) => Number(text.trim())),
    );
  });
}
```

Note: the darwin callback resolves `0` whenever `ps` printed nothing (process gone, or `ps` failed). That is acceptable: `createOwnerProbe` only calls this for PIDs that `isRunning` just confirmed, and a `0` marks the owner dead exactly like a vanished process. Keep this simpler rule; do not add more branches. `done` is only used by the Windows branch — inline it there if lint flags it.

- [ ] **Step 4: Skip PowerShell tests off Windows** — in `src/tests/monitor.test.ts` change the four `test('…', async () => {` calls at lines 134, 293, 374, 456 to pass an options object:

```ts
const windowsOnly = { skip: process.platform !== 'win32' && 'needs Windows PowerShell' };
// …
test('real PowerShell writer -> file monitor, private fields removed', windowsOnly, async () => {
```

Declare `windowsOnly` once near the top (after the `event` helper). Apply to exactly these four tests: `real PowerShell writer -> file monitor, private fields removed`, `installer merges existing settings and is idempotent`, `installed hooks preserve CLI ownership within the timeout and tolerate a missing helper`, `installer migrates console-hiding hooks without duplicates or changing other hooks/trust`.

- [ ] **Step 5: Run tests** — `npm test` — Expected: all pass on Windows (new tests included); `npm run check` passes.

- [ ] **Step 6: Commit**

```bash
git add src/common/platform.ts src/monitor/process-owner.ts src/tests/platform.test.ts src/tests/monitor.test.ts
git commit -m "feat: add platform helpers and macOS process start time"
```

---

### Task 2: Platform-specific update asset and macOS download flow

**Files:**
- Modify: `src/main/update-release.ts`
- Modify: `src/main/updater.ts`
- Test: `src/tests/platform.test.ts` (append)

**Interfaces:**
- Produces: `updateAsset(platform: NodeJS.Platform, arch: string): string | undefined` in `src/main/update-release.ts`.

- [ ] **Step 1: Write the failing test** — append to `src/tests/platform.test.ts` (add import `import { updateAsset } from '../main/update-release';`)

```ts
test('update asset matches the release file for this platform and CPU', () => {
  assert.equal(updateAsset('win32', 'x64'), 'AgentStatus.exe');
  assert.equal(updateAsset('darwin', 'arm64'), 'AgentStatus-mac-arm64.dmg');
  assert.equal(updateAsset('darwin', 'x64'), 'AgentStatus-mac-x64.dmg');
  assert.equal(updateAsset('darwin', 'ia32'), undefined);
  assert.equal(updateAsset('linux', 'x64'), undefined);
});
```

- [ ] **Step 2: Run** `npm run build` — Expected: FAIL (`updateAsset` not exported).

- [ ] **Step 3: Implement** — append to `src/main/update-release.ts`:

```ts
/** Release file this build updates from; undefined when no build is published for it. */
export function updateAsset(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === 'win32') return 'AgentStatus.exe';
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64'))
    return `AgentStatus-mac-${arch}.dmg`;
  return undefined;
}
```

In `src/main/updater.ts`:
1. Replace `const ASSET = 'AgentStatus.exe';` with
   ```ts
   const ASSET = updateAsset(process.platform, process.arch);
   ```
   and import `updateAsset`.
2. Replace the Downloads fallback in `chooseTarget` with
   ```ts
   // AgentStatus.exe -> AgentStatus-1.2.0.exe; AgentStatus-mac-arm64.dmg -> AgentStatus-1.2.0-mac-arm64.dmg
   return { file: path.join(app.getPath('downloads'), asset.replace(/^AgentStatus/, `AgentStatus-${version}`)) };
   ```
   giving `chooseTarget(version: string, asset: string)`. `portableExe()` already returns `undefined` on macOS, so mac always lands in Downloads.
3. `expectedDigest(release, asset, signal)` takes the asset name instead of reading `ASSET`.
4. In `start()`: first line after the `busy` guard:
   ```ts
   if (!ASSET) {
     render({ phase: 'error', message: 'Chưa có bản cập nhật tự động cho hệ điều hành này.' });
     return;
   }
   ```
   and pass `ASSET` into `chooseTarget` / `expectedDigest`.
5. The `downloaded` message becomes:
   ```ts
   message:
     process.platform === 'darwin'
       ? `Đã lưu ${path.basename(target.file)} vào ${path.basename(path.dirname(target.file))}. Thoát Agent Status, mở file .dmg rồi kéo Agent Status vào Applications để thay bản cũ.`
       : `Đã lưu ${path.basename(target.file)} vào ${path.basename(path.dirname(target.file))}. Thoát app rồi thay file ${ASSET} bằng file này.`,
   ```

- [ ] **Step 4: Run** `npm test && npm run check` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/update-release.ts src/main/updater.ts src/tests/platform.test.ts
git commit -m "feat: pick the update asset per platform and save mac updates to Downloads"
```

---

### Task 3: Integration backend interface + macOS installer

**Files:**
- Create: `src/main/integration-backend.ts`
- Create: `src/main/integration-mac.ts`
- Modify: `src/main/integration.ts`
- Test: `src/tests/integration-mac.test.ts`

**Interfaces:**
- Produces (in `integration-backend.ts`):
  ```ts
  export interface Installation {
    needsInstall: boolean;
    writerCurrent: boolean;
    agents: { agent: Agent; configured: boolean }[];
  }
  export interface SetupPaths { dataDir: string; integrationDir: string; claudeHome: string; codexHome: string }
  export interface IntegrationBackend {
    check(): Promise<Installation>;
    apply(): Promise<void>;
    /** Bundled files whose content decides whether a deferred setup is offered again. */
    files: string[];
    /** Writer file name shown in the Codex /hooks instructions. */
    writerName: string;
  }
  export function createWindowsBackend(paths: SetupPaths): IntegrationBackend;
  ```
- Produces (in `integration-mac.ts`): `MAC_WRITER = 'write-agent-event.js'`, `macHookCommand(agent: Agent, dataDir: string): string`, `createMacBackend(paths: SetupPaths): IntegrationBackend`.
- `createIntegrationSetup(win: BrowserWindow, dataDir: string, backend: IntegrationBackend | undefined)` — new signature consumed by Task 5.

- [ ] **Step 1: Write the failing test** — `src/tests/integration-mac.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createMacBackend, macHookCommand, MAC_WRITER } from '../main/integration-mac';

async function setup() {
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(path.resolve('.test-data/mac setup-'));
  const paths = {
    dataDir: path.join(root, 'Application Support', 'AgentStatus'),
    integrationDir: path.resolve('integration'),
    claudeHome: path.join(root, '.claude'),
    codexHome: path.join(root, '.codex'),
  };
  return { root, paths, backend: createMacBackend(paths) };
}
const read = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

test('mac installer: fresh install, keeps other hooks, idempotent, backs up', async () => {
  const { paths, backend } = await setup();
  await mkdir(paths.claudeHome, { recursive: true });
  const settings = path.join(paths.claudeHome, 'settings.json');
  await writeFile(
    settings,
    JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] } }),
  );

  const before = await backend.check();
  assert.equal(before.needsInstall, true);
  assert.equal(before.writerCurrent, false);
  assert.deepEqual(before.agents.map((a) => a.configured), [false, false]);

  await backend.apply();
  const after = await backend.check();
  assert.deepEqual(after, {
    needsInstall: false,
    writerCurrent: true,
    agents: [
      { agent: 'claude', configured: true },
      { agent: 'codex', configured: true },
    ],
  });

  const claude = await read(settings);
  assert.equal(claude.theme, 'dark');
  assert.deepEqual(claude.hooks.Stop[0].hooks[0], { type: 'command', command: 'echo existing' });
  assert.deepEqual(claude.hooks.Stop[1].hooks[0], {
    type: 'command',
    command: macHookCommand('claude', paths.dataDir),
    timeout: 3,
  });
  for (const name of ['SessionStart', 'PermissionRequest', 'Notification', 'ElicitationResult'])
    assert.equal(claude.hooks[name].length, 1, name);
  const codex = await read(path.join(paths.codexHome, 'hooks.json'));
  assert.ok(codex.hooks.Interrupt);
  assert.equal(codex.hooks.Notification, undefined);

  assert.equal(
    await readFile(path.join(paths.dataDir, MAC_WRITER), 'utf8'),
    await readFile(path.join(paths.integrationDir, 'mac', MAC_WRITER), 'utf8'),
  );
  assert.equal((await readdir(paths.claudeHome)).filter((f) => f.endsWith('.bak')).length, 1);

  await backend.apply();
  assert.deepEqual(await read(settings), claude, 'Reinstalling does not duplicate handlers');
});

test('mac installer: hook command quotes paths with spaces', () => {
  assert.equal(
    macHookCommand('codex', '/Users/a/Library/Application Support/AgentStatus'),
    '/usr/bin/osascript -l JavaScript "' +
      path.join('/Users/a/Library/Application Support/AgentStatus', MAC_WRITER) +
      '" codex "/Users/a/Library/Application Support/AgentStatus"',
  );
});

test('mac installer: stale handler from an old data dir is replaced, not duplicated', async () => {
  const { paths, backend } = await setup();
  await mkdir(paths.claudeHome, { recursive: true });
  const settings = path.join(paths.claudeHome, 'settings.json');
  await writeFile(
    settings,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: macHookCommand('claude', '/old/AgentStatus'), timeout: 3 },
              { type: 'command', command: 'echo keep' },
            ],
          },
        ],
      },
    }),
  );
  assert.equal((await backend.check()).agents[0].configured, false);
  await backend.apply();
  const stop = (await read(settings)).hooks.Stop;
  assert.deepEqual(stop, [
    { hooks: [{ type: 'command', command: 'echo keep' }] },
    { hooks: [{ type: 'command', command: macHookCommand('claude', paths.dataDir), timeout: 3 }] },
  ]);
});

test('mac installer: malformed settings abort without touching any file', async () => {
  const { paths, backend } = await setup();
  await mkdir(paths.claudeHome, { recursive: true });
  const settings = path.join(paths.claudeHome, 'settings.json');
  await writeFile(settings, '{ "theme": ');
  await assert.rejects(backend.check(), /settings\.json/);
  await assert.rejects(backend.apply(), /settings\.json/);
  assert.equal(await readFile(settings, 'utf8'), '{ "theme": ');
  await assert.rejects(readFile(path.join(paths.codexHome, 'hooks.json')), /ENOENT/);
});
```

- [ ] **Step 2: Run** `npm run build` — Expected: FAIL (`integration-mac` missing).

- [ ] **Step 3: Implement `src/main/integration-backend.ts`** — move the PowerShell call out of `integration.ts` unchanged:

```ts
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { POWERSHELL } from '../common/powershell';
import type { Agent } from '../monitor/status';

export interface Installation {
  needsInstall: boolean;
  writerCurrent: boolean;
  agents: { agent: Agent; configured: boolean }[];
}
export interface SetupPaths {
  dataDir: string;
  integrationDir: string;
  claudeHome: string;
  codexHome: string;
}
export interface IntegrationBackend {
  check(): Promise<Installation>;
  apply(): Promise<void>;
  /** Bundled files whose content decides whether a deferred setup is offered again. */
  files: string[];
  /** Writer file name shown in the Codex /hooks instructions. */
  writerName: string;
}

const execute = promisify(execFile);

export function createWindowsBackend(paths: SetupPaths): IntegrationBackend {
  const installer = path.join(paths.integrationDir, 'Install-Hooks.ps1');
  const run = async (mode: '-Check' | '-Apply') =>
    execute(
      POWERSHELL,
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        installer,
        mode,
        '-DataDir',
        paths.dataDir,
        '-ClaudeHome',
        paths.claudeHome,
        '-CodexHome',
        paths.codexHome,
      ],
      { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 },
    );
  return {
    check: async () => JSON.parse((await run('-Check')).stdout) as Installation,
    apply: async () => {
      await run('-Apply');
    },
    files: [
      installer,
      path.join(paths.integrationDir, 'Write-AgentEvent.ps1'),
      path.join(paths.integrationDir, 'ProcessOwner.cs'),
    ],
    writerName: 'Write-AgentEvent.ps1',
  };
}
```

- [ ] **Step 4: Implement `src/main/integration-mac.ts`**

```ts
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Agent } from '../monitor/status';
import type { Installation, IntegrationBackend, SetupPaths } from './integration-backend';

export const MAC_WRITER = 'write-agent-event.js';
const COMMON = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'Stop',
];
const EVENTS: Record<Agent, string[]> = {
  claude: [...COMMON, 'PostToolUseFailure', 'StopFailure', 'Notification', 'Elicitation', 'ElicitationResult'],
  codex: [...COMMON, 'Interrupt'],
};

interface Handler {
  type?: unknown;
  command?: unknown;
  [key: string]: unknown;
}
interface Group {
  matcher?: unknown;
  hooks?: Handler[];
  [key: string]: unknown;
}
type Settings = { hooks?: Record<string, Group[]>; [key: string]: unknown };

export function macHookCommand(agent: Agent, dataDir: string): string {
  return `/usr/bin/osascript -l JavaScript "${path.join(dataDir, MAC_WRITER)}" ${agent} "${dataDir}"`;
}

const isOwn = (handler: Handler, agent: Agent) =>
  typeof handler.command === 'string' &&
  handler.command.includes(MAC_WRITER) &&
  new RegExp(`\\s${agent}(\\s|$)`).test(handler.command);

async function readSettings(file: string): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Settings;
  } catch {
    /* Reported below. */
  }
  throw new Error(`Không đọc được ${file}: JSON không hợp lệ.`);
}

/** Same merge rules as Install-Hooks.ps1: drop our handlers, keep every other hook, append ours. */
function merge(settings: Settings, agent: Agent, command: string) {
  const hooks = { ...(settings.hooks ?? {}) };
  let configured = true;
  for (const name of EVENTS[agent]) {
    const groups: Group[] = [];
    let found = false;
    for (const group of hooks[name] ?? []) {
      const handlers = Array.isArray(group.hooks) ? group.hooks : [];
      if (
        handlers.some((h) => h.command === command && h.type === 'command') &&
        (!group.matcher || group.matcher === '*')
      )
        found = true;
      const remaining = handlers.filter((h) => !isOwn(h, agent));
      if (remaining.length) groups.push({ ...group, hooks: remaining });
    }
    if (!found) configured = false;
    groups.push({ hooks: [{ type: 'command', command, timeout: 3 }] });
    hooks[name] = groups;
  }
  return { settings: { ...settings, hooks }, configured };
}

const sha256 = async (file: string) =>
  createHash('sha256').update(await readFile(file)).digest('hex');

export function createMacBackend(paths: SetupPaths): IntegrationBackend {
  const bundled = path.join(paths.integrationDir, 'mac', MAC_WRITER);
  const installed = path.join(paths.dataDir, MAC_WRITER);
  const targets: Record<Agent, string> = {
    claude: path.join(paths.claudeHome, 'settings.json'),
    codex: path.join(paths.codexHome, 'hooks.json'),
  };
  // Every file is parsed before anything is written, so a bad file aborts the whole install.
  const plan = async () =>
    Promise.all(
      (['claude', 'codex'] as Agent[]).map(async (agent) => ({
        agent,
        target: targets[agent],
        ...merge(await readSettings(targets[agent]), agent, macHookCommand(agent, paths.dataDir)),
      })),
    );
  return {
    async check(): Promise<Installation> {
      const plans = await plan();
      let writerCurrent = false;
      try {
        writerCurrent = (await sha256(installed)) === (await sha256(bundled));
      } catch {
        /* Not installed yet. */
      }
      const agents = plans.map(({ agent, configured }) => ({ agent, configured }));
      return { writerCurrent, agents, needsInstall: !writerCurrent || agents.some((a) => !a.configured) };
    },
    async apply() {
      const plans = await plan();
      await mkdir(paths.dataDir, { recursive: true });
      await copyFile(bundled, installed);
      for (const { target, settings } of plans) {
        await mkdir(path.dirname(target), { recursive: true });
        try {
          await copyFile(target, `${target}.agent-status-${randomUUID()}.bak`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await writeFile(target, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      }
    },
    files: [bundled],
    writerName: MAC_WRITER,
  };
}
```

Note: the test at Step 1 needs `integration/mac/write-agent-event.js` to exist. Create it now with the content from Task 4 Step 3 (the whole file), so this task's tests pass; Task 4 adds its darwin tests.

- [ ] **Step 5: Refactor `src/main/integration.ts`** to use the backend:
  - Remove `execFile`, `promisify`, `POWERSHELL`, the local `Installation`/`SetupPaths` interfaces, `execute`, `installer`, `run`, `check`.
  - New signature: `export function createIntegrationSetup(win: BrowserWindow, dataDir: string, backend: IntegrationBackend | undefined)`.
  - `const preferenceFile = path.join(dataDir, 'setup.json');`
  - `nextSteps` becomes a function `const nextSteps = (writer: string) => 'Claude Code: …' + \`… các hook gọi ${writer}, …\``, keeping the existing text verbatim except the file name.
  - In `show`: guard becomes `if (busy || win.isDestroyed() || !backend) return;`; `const current = await backend.check();`; fingerprint:
    ```ts
    const hash = createHash('sha256');
    for (const file of backend.files) hash.update(await readFile(file));
    const fingerprint = hash.digest('hex');
    ```
  - `await run('-Apply')` → `await backend.apply()`; `(await check()).needsInstall` → `(await backend.check()).needsInstall`; `nextSteps` → `nextSteps(backend.writerName)`.

- [ ] **Step 6: Run** `npm test && npm run check` — Expected: PASS on Windows.

- [ ] **Step 7: Commit**

```bash
git add src/main/integration-backend.ts src/main/integration-mac.ts src/main/integration.ts src/tests/integration-mac.test.ts integration/mac/write-agent-event.js
git commit -m "feat: add macOS hook installer behind an integration backend"
```

---

### Task 4: JXA hook writer + darwin tests + lint config

**Files:**
- Create/finalize: `integration/mac/write-agent-event.js`
- Modify: `eslint.config.mjs`
- Test: `src/tests/integration-mac.test.ts` (append darwin-only tests)

**Interfaces:**
- Consumes: `MAC_WRITER`, `setup()` helper already in the test file. The JXA file duplicates `parseLstart`'s regex (it cannot import TS).

- [ ] **Step 1: Write the failing (darwin-only) tests** — append to `src/tests/integration-mac.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { symlink } from 'node:fs/promises';

const macOnly = { skip: process.platform !== 'darwin' && 'needs macOS osascript' };
const writer = path.resolve('integration/mac', MAC_WRITER);
const payload = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    session_id: 'abc',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: 'tu1',
    prompt: 'SECRET PROMPT',
    tool_input: { command: 'SECRET INPUT', nothing: null },
    tool_response: 'x'.repeat(2 * 1024 * 1024),
    ...extra,
  });

test('JXA writer records only allowed fields, prints nothing, exits 0', macOnly, async () => {
  const { paths } = await setup();
  const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', writer, 'claude', paths.dataDir], {
    input: payload(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const dir = path.join(paths.dataDir, 'events', 'claude');
  const files = await readdir(dir);
  assert.deepEqual(files.filter((f) => !f.endsWith('.json')), []);
  assert.equal(files.length, 1);
  const text = await readFile(path.join(dir, files[0]), 'utf8');
  assert.doesNotMatch(text, /SECRET|xxxx/);
  const record = JSON.parse(text);
  assert.equal(record.agent, 'claude');
  assert.equal(record.session_id, 'abc');
  assert.equal(record.hook_event_name, 'PreToolUse');
  assert.equal(record.tool_name, 'Bash');
  assert.equal(record.tool_use_id, 'tu1');
  assert.ok(Math.abs(record.timestamp - Date.now()) < 60000);
});

test('JXA writer ignores incomplete payloads and unknown agents', macOnly, async () => {
  const { paths } = await setup();
  for (const [agent, input] of [
    ['claude', JSON.stringify({ hook_event_name: 'Stop' })],
    ['claude', 'not json'],
    ['other', payload()],
  ]) {
    const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', writer, agent, paths.dataDir], {
      input,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  }
  await assert.rejects(readdir(path.join(paths.dataDir, 'events')), /ENOENT/);
});

test('JXA writer finds the owning CLI process and its start time', macOnly, async () => {
  const { root, paths } = await setup();
  const fakeClaude = path.join(root, 'claude');
  await symlink('/bin/sh', fakeClaude);
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  // The trailing `; true` stops sh from exec-ing osascript in place of itself.
  const script = `/usr/bin/osascript -l JavaScript ${quote(writer)} claude ${quote(paths.dataDir)}; echo "PID=$$"; true`;
  const result = spawnSync(fakeClaude, ['-c', script], { input: payload(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const pid = Number(/PID=(\d+)/.exec(result.stdout)?.[1]);
  const dir = path.join(paths.dataDir, 'events', 'claude');
  const record = JSON.parse(await readFile(path.join(dir, (await readdir(dir))[0]), 'utf8'));
  assert.equal(record.owner_pid, pid);
  // The shell has exited; the start time was captured while it ran, at 1 s resolution.
  assert.ok(Math.abs(record.owner_started_at - Date.now()) < 60000);
  assert.equal(record.owner_started_at % 1000, 0);
});
```

(`stdin` of `spawnSync(fakeClaude, …)` is inherited by osascript because `sh -c` passes its stdin to children.)

- [ ] **Step 2: Run** — on Windows these three are skipped. They are verified on the macOS CI job (Task 7). Locally, just `npm run build` must compile.

- [ ] **Step 3: Implement `integration/mac/write-agent-event.js`**

```js
// Agent Status hook writer for macOS. Run by: /usr/bin/osascript -l JavaScript <this> <agent> <dataDir>
// Monitoring must never block the agent: every error is swallowed, nothing is printed, exit 0.
ObjC.import('Foundation');

const FIELDS = ['tool_name', 'tool_use_id', 'notification_type', 'source'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Same rules as parseLstart in src/monitor/process-owner.ts; both sides must agree exactly.
function parseLstart(text) {
  const match = /^\w{3} (\w{3}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4})$/.exec(text.trim());
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  if (!match || month < 0) return 0;
  return new Date(+match[6], month, +match[2], +match[3], +match[4], +match[5]).getTime();
}

function utf8(data) {
  return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
}

function processTable() {
  const task = $.NSTask.alloc.init;
  task.executableURL = $.NSURL.fileURLWithPath('/bin/ps');
  task.arguments = $(['-A', '-o', 'pid=,ppid=,lstart=,args=']);
  const env = $.NSMutableDictionary.dictionaryWithDictionary($.NSProcessInfo.processInfo.environment);
  env.setObjectForKey('C', 'LC_ALL');
  task.environment = env;
  const pipe = $.NSPipe.pipe;
  task.standardOutput = pipe;
  task.standardError = $.NSFileHandle.fileHandleWithNullDevice;
  if (!task.launchAndReturnError($())) return new Map();
  const text = utf8(pipe.fileHandleForReading.readDataToEndOfFile);
  task.waitUntilExit;
  const table = new Map();
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3} +\d{1,2} \d\d:\d\d:\d\d \d{4})\s+(.*)$/.exec(line);
    if (match)
      table.set(+match[1], { ppid: +match[2], started: parseLstart(match[3]), args: match[4] });
  }
  return table;
}

function matches(agent, args) {
  const name = args.split(' ')[0].split('/').pop();
  if (name === agent || name.startsWith(agent + '-')) return true;
  // npm Claude runs under node; the native installer runs a versioned file via a symlink.
  return agent === 'claude' && (args.includes('claude-code') || args.includes('/claude/versions/'));
}

function findOwner(agent) {
  const table = processTable();
  let id = $.NSProcessInfo.processInfo.processIdentifier;
  let childStarted = Infinity;
  const visited = new Set();
  for (let depth = 0; depth < 8 && id > 1 && !visited.has(id); depth++) {
    visited.add(id);
    const entry = table.get(id);
    // A parent PID may have been reused after the real parent exited.
    if (!entry || !entry.started || entry.started > childStarted) return undefined;
    if (matches(agent, entry.args)) return { pid: id, started: entry.started };
    childStarted = entry.started;
    id = entry.ppid;
  }
  return undefined;
}

// eslint-disable-next-line no-unused-vars -- osascript calls run(argv).
function run(argv) {
  try {
    const agent = argv[0];
    const dataDir = argv[1];
    if ((agent !== 'claude' && agent !== 'codex') || !dataDir) return;
    const input = JSON.parse(utf8($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile));
    if (!input || !input.session_id || !input.hook_event_name) return;
    const record = {
      agent,
      session_id: String(input.session_id),
      hook_event_name: String(input.hook_event_name),
      timestamp: Date.now(),
    };
    for (const field of FIELDS)
      if (input[field] !== undefined && input[field] !== null) record[field] = String(input[field]);
    try {
      const owner = findOwner(agent);
      if (owner) {
        record.owner_pid = owner.pid;
        record.owner_started_at = owner.started;
      }
    } catch {
      // Fresh events still work when process inspection is unavailable.
    }
    const files = $.NSFileManager.defaultManager;
    const dir = dataDir + '/events/' + agent;
    files.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, true, $(), $());
    const name = $.NSUUID.UUID.UUIDString.js;
    const temporary = dir + '/' + name + '.tmp';
    $(JSON.stringify(record)).writeToFileAtomicallyEncodingError(temporary, false, $.NSUTF8StringEncoding, $());
    files.moveItemAtPathToPathError(temporary, dir + '/' + name + '.json', $());
  } catch {
    // Monitoring không được chặn agent hoặc thay đổi approval decision.
  }
}
```

`run` returns `undefined` on every path so osascript prints nothing.

- [ ] **Step 4: ESLint config** — in `eslint.config.mjs` add a block before `prettier`:

```js
  {
    files: ['integration/mac/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ObjC: 'readonly', $: 'readonly' },
    },
  },
```

- [ ] **Step 5: Run** `npm run check && npm test` — Expected: PASS on Windows (darwin tests skipped).

- [ ] **Step 6: Commit**

```bash
git add integration/mac/write-agent-event.js eslint.config.mjs src/tests/integration-mac.test.ts
git commit -m "feat: add JXA hook writer for macOS"
```

---

### Task 5: Wire macOS into window, tray and main

**Files:**
- Modify: `src/main/main.ts`, `src/main/window.ts`, `src/main/tray.ts`

**Interfaces:**
- Consumes: `defaultDataDir`, `isMac`, `isWindows` (Task 1); `createWindowsBackend`, `SetupPaths` (Task 3); `createMacBackend` (Task 3); `createIntegrationSetup(win, dataDir, backend)` (Task 3).

- [ ] **Step 1: `src/main/main.ts`**

```ts
const dataDir = defaultDataDir(process.platform, process.env, app.getPath('appData'));
```
(replacing the current `dataDir` expression; import from `../common/platform`). Then build the paths object currently passed to `createIntegrationSetup`, and:

```ts
const paths: SetupPaths = { dataDir, integrationDir: …, claudeHome: …, codexHome: … }; // same expressions as today
const backend = isWindows ? createWindowsBackend(paths) : isMac ? createMacBackend(paths) : undefined;
const setup = createIntegrationSetup(win, dataDir, backend);
```

- [ ] **Step 2: `src/main/window.ts`** — right after `new BrowserWindow(...)`:

```ts
// Menu bar apps float over every Space and full-screen app, like the Windows topmost window.
if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
```

- [ ] **Step 3: `src/main/tray.ts`**

```ts
const size = isMac ? 18 : 16;
const tray = new Tray(nativeImage.createFromPath(iconFile).resize({ width: size, height: size }));
// …
const loginItem = () =>
  isMac ? app.getLoginItemSettings() : app.getLoginItemSettings({ path: executable });
// …
{
  label: isMac ? 'Start at login' : 'Start with Windows',
  type: 'checkbox',
  enabled: app.isPackaged && (isWindows || isMac),
  checked: app.isPackaged && loginItem().openAtLogin,
  click: (item) =>
    app.setLoginItemSettings(
      isMac
        ? { openAtLogin: item.checked }
        : { openAtLogin: item.checked, path: executable, args: [] },
    ),
},
```

- [ ] **Step 4: Run** `npm run check && npm test && npm run smoke` — Expected: PASS (smoke runs the Windows app headless-ish as today).

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts src/main/window.ts src/main/tray.ts
git commit -m "feat: run on macOS with menu bar tray, all-Spaces window and login item"
```

---

### Task 6: Packaging, version bump and docs

**Files:**
- Modify: `package.json`, `scripts/package-files.cjs`, `README.md`, `RELEASE_NOTES.md`
- Create: `assets/icon-mac.png`

- [ ] **Step 1: `assets/icon-mac.png`** — 1024×1024 upscale of `assets/icon.png` (run on Windows in PowerShell):

```powershell
Add-Type -AssemblyName System.Drawing
$src = [Drawing.Image]::FromFile((Resolve-Path assets/icon.png))
$dst = New-Object Drawing.Bitmap 1024, 1024
$g = [Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.SmoothingMode = 'HighQuality'
$g.DrawImage($src, 0, 0, 1024, 1024)
$dst.Save((Join-Path (Get-Location) 'assets/icon-mac.png'), [Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $dst.Dispose(); $src.Dispose()
```

Verify: `file assets/icon-mac.png` → `PNG image data, 1024 x 1024`.

- [ ] **Step 2: `package.json`**
  - `"version": "1.2.0"`, `"description": "Local floating status indicators for Claude Code and Codex CLI on Windows and macOS"`.
  - scripts:
    ```json
    "dist": "npm run dist:win",
    "dist:win": "npm run build && electron-builder --win portable --x64 && node scripts/package-files.cjs",
    "dist:mac": "npm run build && electron-builder --mac dmg --arm64 --x64 && node scripts/package-files.cjs"
    ```
  - `build` additions:
    ```json
    "mac": {
      "target": "dmg",
      "category": "public.app-category.developer-tools",
      "icon": "assets/icon-mac.png",
      "identity": "-",
      "extendInfo": { "LSUIElement": true }
    },
    "dmg": { "artifactName": "AgentStatus-mac-${arch}.${ext}" }
    ```
  - `build.files` keeps `assets/icon.png` (tray uses it); `icon-mac.png` is build-time only.

- [ ] **Step 3: `scripts/package-files.cjs`**

```js
const fs = require('node:fs');
const crypto = require('node:crypto');
fs.cpSync('integration', 'release/integration', { recursive: true });
for (const file of ['README.md', 'RELEASE_NOTES.md']) fs.copyFileSync(file, `release/${file}`);
const artifacts = fs
  .readdirSync('release')
  .filter((name) => name === 'AgentStatus.exe' || /^AgentStatus-mac-(arm64|x64)\.dmg$/.test(name));
if (!artifacts.length) throw new Error('No release artifact found in release/.');
for (const name of artifacts) {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(`release/${name}`)).digest('hex');
  fs.writeFileSync(`release/${name}.sha256`, `${digest}  ${name}\n`);
}
console.log(`Packaged ${artifacts.join(', ')} with SHA256, integration scripts and documentation in release/.`);
```

- [ ] **Step 4: `README.md`**
  - Intro: "tiện ích Windows" → "tiện ích cho Windows và macOS"; replace the single Windows badge line with Windows + `macOS 12+ (Apple Silicon / Intel)` badges.
  - "Tải về": keep the exe button; add buttons for `https://github.com/x1ncha0/agent-status/releases/latest/download/AgentStatus-mac-arm64.dmg` (Apple Silicon) and `…-mac-x64.dmg` (Intel).
  - New subsection `### Mở lần đầu trên macOS`: kéo **Agent Status** vào Applications; app chưa được ký bởi Apple nên lần đầu chuột phải → **Open** → **Open**, hoặc chạy `xattr -dr com.apple.quarantine "/Applications/Agent Status.app"`. Icon nằm trên menu bar, không có icon Dock. Dữ liệu ở `~/Library/Application Support/AgentStatus`.
  - "Cập nhật app": add a paragraph: trên macOS app tải `.dmg` đúng chip vào Downloads, kiểm SHA256 rồi mở Finder; thoát app, mở `.dmg`, kéo vào Applications để thay bản cũ.
  - "Giới hạn": "Chỉ hỗ trợ CLI native trên Windows…" → "Hỗ trợ CLI chạy trực tiếp trên Windows và macOS…"; "Executable chưa được code-sign." → "Bản Windows và macOS chưa được code-sign / notarize."
  - Menu tray text: mention "Start with Windows / Start at login".

- [ ] **Step 5: `RELEASE_NOTES.md`** — new top section:

```md
## 1.2.0 — 30/09/2026

- Có bản macOS (Apple Silicon và Intel, macOS 12 trở lên): icon trên menu bar, cửa sổ nổi trên mọi Space kể cả app toàn màn hình, không có icon Dock. Thiết lập kết nối cài hook cho Claude Code và Codex bằng bộ ghi trạng thái dùng `osascript` có sẵn của macOS, không cần Node hay Python.
- Kiểm tra cập nhật trên macOS tải `.dmg` đúng chip vào Downloads, đối chiếu SHA256 rồi mở Finder để bạn thay app.
- Menu khay có **Start at login** trên macOS.
- Bản phát hành được build và đăng tự động bằng GitHub Actions cho cả Windows và macOS, kèm file SHA256 cho từng bản.
```

- [ ] **Step 6: Run** `npm run check && npm test && npm run dist:win` — Expected: PASS; `release/AgentStatus.exe` and `release/AgentStatus.exe.sha256` exist.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/package-files.cjs assets/icon-mac.png README.md RELEASE_NOTES.md
git commit -m "chore: package macOS dmg builds and release 1.2.0 docs"
```

(`npm install --package-lock-only` if `package-lock.json` version field must follow `package.json`.)

---

### Task 7: GitHub Actions build + release workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/release-notes.cjs`

- [ ] **Step 1: `scripts/release-notes.cjs`** — prints the RELEASE_NOTES section for a version:

```js
const fs = require('node:fs');
const version = process.argv[2];
const lines = fs.readFileSync('RELEASE_NOTES.md', 'utf8').split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith(`## ${version} `));
if (start < 0) throw new Error(`RELEASE_NOTES.md has no section for ${version}.`);
const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
process.stdout.write(lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim() + '\n');
```

- [ ] **Step 2: `.github/workflows/release.yml`**

```yaml
name: Build and release

on:
  push:
    tags: ['v*']
  pull_request:
  workflow_dispatch:

jobs:
  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm test
      - run: npm run dist:win
      - uses: actions/upload-artifact@v4
        with:
          name: windows
          path: |
            release/AgentStatus.exe
            release/AgentStatus.exe.sha256

  mac:
    runs-on: macos-latest
    env:
      CSC_IDENTITY_AUTO_DISCOVERY: 'false'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm test
      - run: npm run dist:mac
      - name: Verify ad-hoc signatures
        run: |
          for app in release/mac*/"Agent Status.app"; do
            codesign --verify --deep --strict "$app"
            codesign -dv "$app" 2>&1 | grep -q 'Signature=adhoc'
          done
      - uses: actions/upload-artifact@v4
        with:
          name: mac
          path: |
            release/AgentStatus-mac-*.dmg
            release/AgentStatus-mac-*.dmg.sha256

  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: [windows, mac]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true
      - name: Check tag matches package.json
        run: |
          version=$(node -p "require('./package.json').version")
          test "${GITHUB_REF_NAME}" = "v${version}" || { echo "Tag ${GITHUB_REF_NAME} != v${version}"; exit 1; }
      - run: node scripts/release-notes.cjs "${GITHUB_REF_NAME#v}" > notes.md
      - run: gh release create "$GITHUB_REF_NAME" artifacts/* --title "$GITHUB_REF_NAME" --notes-file notes.md
        env:
          GH_TOKEN: ${{ github.token }}
```

- [ ] **Step 3: Verify locally** — `node scripts/release-notes.cjs 1.2.0` prints the 1.2.0 bullets; `node scripts/release-notes.cjs 9.9.9` exits non-zero. `npm run check` passes (prettier formats the YAML).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml scripts/release-notes.cjs
git commit -m "ci: build Windows and macOS and publish releases on tag"
```

- [ ] **Step 5: Push the branch and open a PR** so the `pull_request` trigger runs both jobs; the macOS job is the only verification of Task 4's darwin tests and of `dist:mac`. Fix anything it reports before merging. Tagging `v1.2.0` after merge publishes the release.
