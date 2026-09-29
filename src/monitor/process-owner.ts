import { execFile } from 'node:child_process';
import { POWERSHELL } from '../common/powershell';

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
    execFile(
      POWERSHELL,
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
    const cached = verified.get(key);
    if (cached) return cached;
    const result = startTime(pid).then(
      (actual) => Math.abs(actual - startedAt) < 10,
      () => {
        // The PID is running but its start time is unknown: assume it is still the owner
        // rather than failing the poll (which hides the window), and verify again next poll.
        verified.delete(key);
        return true;
      },
    );
    verified.set(key, result);
    return result;
  };
}
