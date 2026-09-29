import { execFile } from 'node:child_process';
import path from 'node:path';

export type OwnerAlive = (pid: number, startedAt: number) => Promise<boolean>;

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function processStartTime(pid: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const shell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    execFile(
      shell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { ([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() } else { 0 }`,
      ],
      { windowsHide: true, timeout: 3000 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(Number(stdout.trim()));
      },
    );
  });
}

// PID alone can be reused after a restart, so the creation time is verified once per owner.
// Afterwards a cheap liveness check is enough: a PID cannot be reused while its process lives.
export function createOwnerProbe(
  running: (pid: number) => boolean = isRunning,
  startTime: (pid: number) => Promise<number> = processStartTime,
): OwnerAlive {
  const verified = new Map<string, Promise<boolean>>();
  return (pid, startedAt) => {
    const key = `${pid}:${startedAt}`;
    if (!running(pid)) {
      verified.delete(key);
      return Promise.resolve(false);
    }
    let result = verified.get(key);
    if (!result) {
      result = startTime(pid).then((actual) => Math.abs(actual - startedAt) < 10);
      result.catch(() => verified.delete(key));
      verified.set(key, result);
    }
    return result;
  };
}
