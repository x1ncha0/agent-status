import { execFile } from 'node:child_process';
import path from 'node:path';

export type OwnerAlive = (pid: number, startedAt: number) => Promise<boolean>;

// PID alone can be reused after a restart. Check both PID and process creation time.
export function createOwnerProbe(): OwnerAlive {
  const cache = new Map<string, { until: number; result: Promise<boolean> }>();
  return (pid, startedAt) => {
    const key = `${pid}:${startedAt}`;
    const now = Date.now();
    for (const [entry, value] of cache) if (value.until < now) cache.delete(entry);
    const cached = cache.get(key);
    if (cached) return cached.result;
    const result = new Promise<boolean>((resolve, reject) => {
      const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      execFile(shell, ['-NoProfile', '-NonInteractive', '-Command',
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { ([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() } else { 0 }`
      ], { windowsHide: true, timeout: 3000 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(Math.abs(Number(stdout.trim()) - startedAt) < 10);
      });
    });
    cache.set(key, { until: now + 2000, result });
    return result;
  };
}
