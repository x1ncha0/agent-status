import path from 'node:path';

// Full path so a PATH entry named powershell.exe cannot be picked up instead.
export const POWERSHELL = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe',
);
