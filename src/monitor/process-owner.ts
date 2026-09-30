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
