import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createMacBackend, macHookCommand, MAC_WRITER } from '../main/integration-mac';

async function setup() {
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(path.resolve('.test-data/mac setup-'));
  const paths = {
    dataDir: path.join(root, 'Application Support', 'AgentStatus'),
    integrationDir: path.resolve('integration'),
    claudeHome: path.join(root, '.claude'),
    codexHome: path.join(root, '.codex'),
  };
  return { root, paths, backend: createMacBackend(paths) };
}
const read = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

test('mac installer: fresh install, keeps other hooks, idempotent, backs up', async () => {
  const { paths, backend } = await setup();
  await mkdir(paths.claudeHome, { recursive: true });
  const settings = path.join(paths.claudeHome, 'settings.json');
  await writeFile(
    settings,
    JSON.stringify({
      theme: 'dark',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] },
    }),
  );

  const before = await backend.check();
  assert.equal(before.needsInstall, true);
  assert.equal(before.writerCurrent, false);
  assert.deepEqual(
    before.agents.map((a) => a.configured),
    [false, false],
  );

  await backend.apply();
  const after = await backend.check();
  assert.deepEqual(after, {
    needsInstall: false,
    writerCurrent: true,
    agents: [
      { agent: 'claude', configured: true },
      { agent: 'codex', configured: true },
    ],
  });

  const claude = await read(settings);
  assert.equal(claude.theme, 'dark');
  assert.deepEqual(claude.hooks.Stop[0].hooks[0], { type: 'command', command: 'echo existing' });
  assert.deepEqual(claude.hooks.Stop[1].hooks[0], {
    type: 'command',
    command: macHookCommand('claude', paths.dataDir),
    timeout: 3,
  });
  for (const name of ['SessionStart', 'PermissionRequest', 'Notification', 'ElicitationResult'])
    assert.equal(claude.hooks[name].length, 1, name);
  const codex = await read(path.join(paths.codexHome, 'hooks.json'));
  assert.ok(codex.hooks.Interrupt);
  assert.equal(codex.hooks.Notification, undefined);

  assert.equal(
    await readFile(path.join(paths.dataDir, MAC_WRITER), 'utf8'),
    await readFile(path.join(paths.integrationDir, 'mac', MAC_WRITER), 'utf8'),
  );
  assert.equal((await readdir(paths.claudeHome)).filter((f) => f.endsWith('.bak')).length, 1);

  await backend.apply();
  assert.deepEqual(await read(settings), claude, 'Reinstalling does not duplicate handlers');
});

test('mac installer: hook command quotes paths with spaces', () => {
  assert.equal(
    macHookCommand('codex', '/Users/a/Library/Application Support/AgentStatus'),
    '/usr/bin/osascript -l JavaScript "' +
      path.join('/Users/a/Library/Application Support/AgentStatus', MAC_WRITER) +
      '" codex "/Users/a/Library/Application Support/AgentStatus"',
  );
});

test('mac installer: stale handler from an old data dir is replaced, not duplicated', async () => {
  const { paths, backend } = await setup();
  await mkdir(paths.claudeHome, { recursive: true });
  const settings = path.join(paths.claudeHome, 'settings.json');
  await writeFile(
    settings,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: macHookCommand('claude', '/old/AgentStatus'),
                timeout: 3,
              },
              { type: 'command', command: 'echo keep' },
            ],
          },
        ],
      },
    }),
  );
  assert.equal((await backend.check()).agents[0].configured, false);
  await backend.apply();
  const stop = (await read(settings)).hooks.Stop;
  assert.deepEqual(stop, [
    { hooks: [{ type: 'command', command: 'echo keep' }] },
    { hooks: [{ type: 'command', command: macHookCommand('claude', paths.dataDir), timeout: 3 }] },
  ]);
});

test('mac installer: malformed settings abort without touching any file', async () => {
  const { paths, backend } = await setup();
  await mkdir(paths.claudeHome, { recursive: true });
  const settings = path.join(paths.claudeHome, 'settings.json');
  await writeFile(settings, '{ "theme": ');
  await assert.rejects(backend.check(), /settings\.json/);
  await assert.rejects(backend.apply(), /settings\.json/);
  assert.equal(await readFile(settings, 'utf8'), '{ "theme": ');
  await assert.rejects(readFile(path.join(paths.codexHome, 'hooks.json')), /ENOENT/);
});
