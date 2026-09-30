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
  /** Antigravity's ~/.gemini; its global hooks live in config/hooks.json. */
  geminiHome: string;
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
        '-GeminiHome',
        paths.geminiHome,
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
