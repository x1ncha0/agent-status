import { BrowserWindow, dialog } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Agent } from '../monitor/status';

interface Installation {
  needsInstall: boolean;
  writerCurrent: boolean;
  agents: { agent: Agent; configured: boolean }[];
}
interface SetupPaths {
  dataDir: string;
  integrationDir: string;
  claudeHome: string;
  codexHome: string;
}
const execute = promisify(execFile);
const nextSteps =
  'Claude Code: mở lại CLI rồi gửi một yêu cầu.\n\n' +
  'Codex: mở terminal mới, chạy codex, vào /hooks để Review / Trust các hook gọi Write-AgentEvent.ps1, rồi gửi một yêu cầu. Phiên đã mở trước khi cài có thể chưa nhận cấu hình mới.';

export function createIntegrationSetup(win: BrowserWindow, paths: SetupPaths) {
  let busy = false;
  const preferenceFile = path.join(paths.dataDir, 'setup.json');
  const installer = path.join(paths.integrationDir, 'Install-Hooks.ps1');
  const run = async (mode: '-Check' | '-Apply') => {
    const shell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    return execute(
      shell,
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
  };
  const check = async () => {
    const { stdout } = await run('-Check');
    return JSON.parse(stdout) as Installation;
  };
  const show = async (automatic = false) => {
    if (busy || win.isDestroyed() || process.platform !== 'win32') return;
    busy = true;
    try {
      const current = await check();
      if (automatic && !current.needsInstall) return;
      const fingerprint = createHash('sha256')
        .update(await readFile(installer))
        .update(await readFile(path.join(paths.integrationDir, 'Write-AgentEvent.ps1')))
        .digest('hex');
      if (automatic) {
        try {
          if (JSON.parse(await readFile(preferenceFile, 'utf8')).deferred === fingerprint) return;
        } catch {
          /* No deferred setup on first launch. */
        }
      }
      if (win.isDestroyed()) return;
      const summary = current.agents
        .map(
          (agent) =>
            `${agent.agent === 'claude' ? 'Claude Code' : 'Codex'}: ${agent.configured && current.writerCurrent ? 'đã cài kết nối' : 'cần thiết lập / cập nhật'}`,
        )
        .join('\n');
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Agent Status — Thiết lập kết nối',
        message: current.needsInstall
          ? 'Kết nối với Claude Code và Codex'
          : 'Kết nối đã được thiết lập',
        detail:
          summary +
          '\n\n' +
          (current.needsInstall
            ? 'Agent Status sẽ cài bộ ghi trạng thái và thêm hooks vào cấu hình Claude / Codex trên máy này. Cấu hình hiện có được sao lưu và giữ lại.\n\nSau khi cài, Codex cần bạn Trust hooks một lần và dùng phiên CLI mới.'
            : nextSteps),
        buttons: current.needsInstall ? ['Cài đặt kết nối', 'Để sau'] : ['Đóng', 'Cài lại kết nối'],
        defaultId: 0,
        cancelId: current.needsInstall ? 1 : 0,
      });
      const install = response === (current.needsInstall ? 0 : 1);
      if (!install) {
        if (automatic) await writeFile(preferenceFile, JSON.stringify({ deferred: fingerprint }));
        return;
      }
      await run('-Apply');
      if ((await check()).needsInstall) throw new Error('Cấu hình sau khi cài chưa đầy đủ.');
      await writeFile(preferenceFile, '{}');
      if (win.isDestroyed()) return;
      await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Agent Status',
        message: 'Đã cài kết nối',
        detail:
          nextSteps +
          '\n\nĐèn sẽ sáng khi nhận sự kiện từ CLI. Bạn có thể xem lại hướng dẫn ở menu khay hệ thống → Thiết lập kết nối.',
        buttons: ['Đã hiểu'],
      });
    } catch (error) {
      if (!win.isDestroyed())
        await dialog.showMessageBox(win, {
          type: 'error',
          title: 'Agent Status',
          message: 'Chưa thể thiết lập kết nối',
          detail:
            'Mở menu khay hệ thống → Thiết lập kết nối để thử lại.\n\n' + (error as Error).message,
          buttons: ['Đóng'],
        });
    } finally {
      busy = false;
    }
  };
  return {
    show: () => show(),
    checkOnStartup: () => show(true),
  };
}
