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
