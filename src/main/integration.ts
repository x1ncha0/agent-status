import { BrowserWindow, dialog } from 'electron';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AGENT_NAMES } from '../monitor/status';
import type { IntegrationBackend } from './integration-backend';

const nextSteps = (writer: string) =>
  'Claude Code: mở lại CLI rồi gửi một yêu cầu.\n\n' +
  `Codex: mở terminal mới, chạy codex, vào /hooks để Review / Trust các hook gọi ${writer}, rồi gửi một yêu cầu. Phiên đã mở trước khi cài có thể chưa nhận cấu hình mới.\n\n` +
  'Antigravity: mở cuộc hội thoại mới rồi gửi một yêu cầu.';

export function createIntegrationSetup(
  win: BrowserWindow,
  dataDir: string,
  backend: IntegrationBackend | undefined,
) {
  let busy = false;
  const preferenceFile = path.join(dataDir, 'setup.json');
  const show = async (automatic = false) => {
    if (busy || win.isDestroyed() || !backend) return;
    busy = true;
    try {
      const current = await backend.check();
      if (automatic && !current.needsInstall) return;
      const hash = createHash('sha256');
      for (const file of backend.files) hash.update(await readFile(file));
      const fingerprint = hash.digest('hex');
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
            `${agent.agent === 'claude' ? 'Claude Code' : AGENT_NAMES[agent.agent]}: ${agent.configured && current.writerCurrent ? 'đã cài kết nối' : 'cần thiết lập / cập nhật'}`,
        )
        .join('\n');
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Agent Status — Thiết lập kết nối',
        message: current.needsInstall ? 'Kết nối với các agent' : 'Kết nối đã được thiết lập',
        detail:
          summary +
          '\n\n' +
          (current.needsInstall
            ? 'Agent Status sẽ cài bộ ghi trạng thái và thêm hooks vào cấu hình Claude / Codex / Antigravity trên máy này. Cấu hình hiện có được sao lưu và giữ lại.\n\nSau khi cài, Codex cần bạn Trust hooks một lần và dùng phiên CLI mới.'
            : nextSteps(backend.writerName)),
        buttons: current.needsInstall ? ['Cài đặt kết nối', 'Để sau'] : ['Đóng', 'Cài lại kết nối'],
        defaultId: 0,
        cancelId: current.needsInstall ? 1 : 0,
      });
      const install = response === (current.needsInstall ? 0 : 1);
      if (!install) {
        if (automatic) await writeFile(preferenceFile, JSON.stringify({ deferred: fingerprint }));
        return;
      }
      await backend.apply();
      if ((await backend.check()).needsInstall)
        throw new Error('Cấu hình sau khi cài chưa đầy đủ.');
      await writeFile(preferenceFile, '{}');
      if (win.isDestroyed()) return;
      await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Agent Status',
        message: 'Đã cài kết nối',
        detail:
          nextSteps(backend.writerName) +
          '\n\nĐèn sẽ sáng khi nhận sự kiện từ agent. Bạn có thể xem lại hướng dẫn ở menu khay hệ thống → Thiết lập kết nối.',
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
