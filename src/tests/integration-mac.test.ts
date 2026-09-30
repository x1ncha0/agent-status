import { parseLstart } from '../monitor/process-owner';
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

import { spawnSync } from 'node:child_process';
import { symlink } from 'node:fs/promises';

const macOnly = { skip: process.platform !== 'darwin' && 'needs macOS osascript' };
const writer = path.resolve('integration/mac', MAC_WRITER);
const payload = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    session_id: 'abc',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: 'tu1',
    prompt: 'SECRET PROMPT',
    tool_input: { command: 'SECRET INPUT', nothing: null },
    tool_response: 'x'.repeat(2 * 1024 * 1024),
    ...extra,
  });

test('JXA writer records only allowed fields, prints nothing, exits 0', macOnly, async () => {
  const { paths } = await setup();
  const result = spawnSync(
    '/usr/bin/osascript',
    ['-l', 'JavaScript', writer, 'claude', paths.dataDir],
    {
      input: payload(),
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const dir = path.join(paths.dataDir, 'events', 'claude');
  const files = await readdir(dir);
  assert.deepEqual(
    files.filter((f) => !f.endsWith('.json')),
    [],
  );
  assert.equal(files.length, 1);
  const text = await readFile(path.join(dir, files[0]), 'utf8');
  assert.doesNotMatch(text, /SECRET|xxxx/);
  const record = JSON.parse(text);
  assert.equal(record.agent, 'claude');
  assert.equal(record.session_id, 'abc');
  assert.equal(record.hook_event_name, 'PreToolUse');
  assert.equal(record.tool_name, 'Bash');
  assert.equal(record.tool_use_id, 'tu1');
  assert.ok(Math.abs(record.timestamp - Date.now()) < 60000);
});

test('JXA writer ignores incomplete payloads and unknown agents', macOnly, async () => {
  const { paths } = await setup();
  for (const [agent, input] of [
    ['claude', JSON.stringify({ hook_event_name: 'Stop' })],
    ['claude', 'not json'],
    ['other', payload()],
  ]) {
    const result = spawnSync(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', writer, agent, paths.dataDir],
      {
        input,
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  }
  await assert.rejects(readdir(path.join(paths.dataDir, 'events')), /ENOENT/);
});

test('JXA writer finds the owning CLI process and its start time', macOnly, async () => {
  const { root, paths } = await setup();
  const fakeClaude = path.join(root, 'claude');
  await symlink('/bin/sh', fakeClaude);
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  // The trailing `; true` stops sh from exec-ing osascript in place of itself.
  const script = `LC_ALL=C /bin/ps -o lstart= -p $; /usr/bin/osascript -l JavaScript ${quote(writer)} claude ${quote(paths.dataDir)}; echo "PID=$$"; true`;
  const result = spawnSync(fakeClaude, ['-c', script], { input: payload(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const pid = Number(/PID=(\d+)/.exec(result.stdout)?.[1]);
  const dir = path.join(paths.dataDir, 'events', 'claude');
  const record = JSON.parse(await readFile(path.join(dir, (await readdir(dir))[0]), 'utf8'));
  assert.equal(record.owner_pid, pid);
  assert.equal(record.owner_started_at, parseLstart(result.stdout.split('\n')[0]));
  // The shell has exited; the start time was captured while it ran, at 1 s resolution.
  assert.ok(Math.abs(record.owner_started_at - Date.now()) < 60000);
  assert.equal(record.owner_started_at % 1000, 0);
});
