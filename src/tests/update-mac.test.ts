import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { macBundlePath, stageFromDmg, startSwap } from '../main/update-mac';

const macOnly = { skip: process.platform !== 'darwin' && 'needs macOS hdiutil' };
const BUNDLE_ID = 'local.agentstatus.app';

test('mac bundle path comes from the executable, never from a dmg or translocation', () => {
  assert.equal(
    macBundlePath('/Applications/Agent Status.app/Contents/MacOS/Agent Status'),
    '/Applications/Agent Status.app',
  );
  assert.equal(
    macBundlePath('/Users/a/Apps/Agent Status.app/Contents/MacOS/Agent Status'),
    '/Users/a/Apps/Agent Status.app',
  );
  assert.equal(macBundlePath('/Volumes/Agent Status/Agent Status.app/Contents/MacOS/x'), undefined);
  assert.equal(
    macBundlePath(
      '/private/var/folders/xy/T/AppTranslocation/1234/d/Agent Status.app/Contents/MacOS/x',
    ),
    undefined,
  );
  assert.equal(macBundlePath('/usr/local/bin/electron'), undefined);
});

async function fakeApp(dir: string, version: string, id = BUNDLE_ID, marker = version) {
  const app = path.join(dir, 'Agent Status.app');
  await mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  const plist = path.join(app, 'Contents', 'Info.plist');
  spawnSync('/usr/bin/plutil', ['-create', 'xml1', plist]);
  spawnSync('/usr/bin/plutil', ['-insert', 'CFBundleIdentifier', '-string', id, plist]);
  spawnSync('/usr/bin/plutil', [
    '-insert',
    'CFBundleShortVersionString',
    '-string',
    version,
    plist,
  ]);
  await writeFile(path.join(app, 'Contents', 'MacOS', 'marker'), marker);
  return app;
}

async function fakeDmg(root: string, version: string, id = BUNDLE_ID) {
  const source = await mkdtemp(path.join(root, 'src-'));
  await fakeApp(source, version, id);
  const dmg = path.join(root, `update-${version}-${id}.dmg`);
  const made = spawnSync('/usr/bin/hdiutil', [
    'create',
    '-quiet',
    '-srcfolder',
    source,
    '-volname',
    'Agent Status',
    '-format',
    'UDZO',
    '-ov',
    dmg,
  ]);
  assert.equal(made.status, 0, String(made.stderr));
  return dmg;
}

const root = () => mkdtemp(path.join(tmpdir(), 'agent-status-update-'));

test('staging copies the app from the dmg next to the running bundle', macOnly, async () => {
  const dir = await root();
  const bundle = await fakeApp(path.join(dir, 'Applications'), '1.2.1');
  const staged = await stageFromDmg(await fakeDmg(dir, '1.3.0'), bundle, '1.3.0');
  assert.equal(path.dirname(staged), path.dirname(bundle));
  assert.equal(await readFile(path.join(staged, 'Contents/MacOS/marker'), 'utf8'), '1.3.0');
  const mounts = spawnSync('/usr/bin/hdiutil', ['info'], { encoding: 'utf8' }).stdout;
  assert.ok(!mounts.includes(dir), 'The dmg is detached after staging');
});

test('staging rejects a dmg with another app or version', macOnly, async () => {
  const dir = await root();
  const bundle = await fakeApp(path.join(dir, 'Applications'), '1.2.1');
  await assert.rejects(
    stageFromDmg(await fakeDmg(dir, '1.3.0', 'com.example.other'), bundle, '1.3.0'),
    /com\.example\.other/,
  );
  await assert.rejects(stageFromDmg(await fakeDmg(dir, '1.2.9'), bundle, '1.3.0'), /1\.2\.9/);
  assert.deepEqual(await readdir(path.dirname(bundle)), ['Agent Status.app']);
});

async function opener(dir: string) {
  const log = path.join(dir, 'opened.txt');
  const script = path.join(dir, 'open.sh');
  await writeFile(script, `#!/bin/sh\necho "$@" >> '${log}'\n`);
  await chmod(script, 0o755);
  return { script, log };
}

async function waitFor(file: string) {
  for (let i = 0; i < 100; i++) {
    try {
      return await readFile(file, 'utf8');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}

test('swap waits for the old app to exit, replaces it and opens the new one', macOnly, async () => {
  const dir = await root();
  const bundle = await fakeApp(path.join(dir, 'Applications'), '1.2.1');
  const staged = await stageFromDmg(await fakeDmg(dir, '1.3.0'), bundle, '1.3.0');
  const running = spawn('/bin/sleep', ['1']);
  const { script, log } = await opener(dir);
  startSwap(running.pid!, bundle, staged, script);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    await readFile(path.join(bundle, 'Contents/MacOS/marker'), 'utf8'),
    '1.2.1',
    'Nothing is replaced while the old app runs',
  );
  assert.equal((await waitFor(log)).trim(), bundle);
  assert.equal(await readFile(path.join(bundle, 'Contents/MacOS/marker'), 'utf8'), '1.3.0');
  assert.deepEqual(await readdir(path.dirname(bundle)), ['Agent Status.app']);
});

test('a failed swap keeps and reopens the old app', macOnly, async () => {
  const dir = await root();
  const bundle = await fakeApp(path.join(dir, 'Applications'), '1.2.1');
  const { script, log } = await opener(dir);
  startSwap(999999, bundle, path.join(dir, 'missing.app'), script);
  assert.equal((await waitFor(log)).trim(), bundle);
  assert.equal(await readFile(path.join(bundle, 'Contents/MacOS/marker'), 'utf8'), '1.2.1');
  assert.deepEqual(await readdir(path.dirname(bundle)), ['Agent Status.app']);
});
