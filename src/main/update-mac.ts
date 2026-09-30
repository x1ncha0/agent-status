import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const APP = 'Agent Status.app';
const BUNDLE_ID = 'local.agentstatus.app';

/**
 * The .app bundle that can be replaced in place, or undefined when the app runs from a dmg or
 * from a Gatekeeper translocation copy (neither is where the user keeps the app).
 */
export function macBundlePath(execPath: string): string | undefined {
  const match = /^(.+?\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  if (!match || match[1].startsWith('/Volumes/') || match[1].includes('/AppTranslocation/'))
    return undefined;
  return match[1];
}

const plistValue = async (plist: string, key: string) =>
  (await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim();

/** Copies the app out of a verified dmg to a hidden sibling of `bundle` and returns its path. */
export async function stageFromDmg(dmg: string, bundle: string, version: string): Promise<string> {
  const mount = await mkdtemp(path.join(tmpdir(), 'agent-status-mount-'));
  await run(
    '/usr/bin/hdiutil',
    ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg],
    { timeout: 60000 },
  );
  try {
    const source = path.join(mount, APP);
    const plist = path.join(source, 'Contents', 'Info.plist');
    const id = await plistValue(plist, 'CFBundleIdentifier');
    if (id !== BUNDLE_ID) throw new Error(`Bản cập nhật có bundle id lạ: ${id}`);
    const found = await plistValue(plist, 'CFBundleShortVersionString');
    if (found !== version) throw new Error(`Bản cập nhật là ${found}, không phải ${version}.`);
    const staged = path.join(path.dirname(bundle), `.${APP.replace(/\.app$/, '')}.update.app`);
    await rm(staged, { recursive: true, force: true });
    await run('/usr/bin/ditto', [source, staged], { timeout: 120000 });
    // A file this app downloaded has no quarantine flag; clear it anyway so Gatekeeper stays quiet.
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', staged]).catch(() => {});
    return staged;
  } finally {
    await run('/usr/bin/hdiutil', ['detach', mount, '-force', '-quiet']).catch(() => {});
    await rm(mount, { recursive: true, force: true }).catch(() => {});
  }
}

// Runs after this app quits: a bundle cannot be replaced safely while its process runs.
// Any failure restores the old bundle, and whichever bundle is in place gets reopened.
const SWAP = `
pid=$1 app=$2 new=$3 open=$4 old="$2.old"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -gt 600 ] && { rm -rf "$new"; exit 1; }
  sleep 0.1
done
rm -rf "$old"
if [ -d "$new" ] && mv "$app" "$old"; then
  if mv "$new" "$app"; then rm -rf "$old"; else mv "$old" "$app"; fi
fi
rm -rf "$new"
"$open" "$app"
`;

/** Starts the detached swap; the caller must quit so `pid` exits. */
export function startSwap(pid: number, bundle: string, staged: string, open = '/usr/bin/open') {
  spawn('/bin/sh', ['-c', SWAP, 'agent-status-update', String(pid), bundle, staged, open], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}
