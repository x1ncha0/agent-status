import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  antigravityHooks,
  createMacBackend,
  macAntigravityCommand,
  macHookCommand,
  MAC_WRITER,
} from '../main/integration-mac';
import { parseLstart } from '../monitor/process-owner';

async function setup() {
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(path.resolve('.test-data/mac setup-'));
  const paths = {
    dataDir: path.join(root, 'Application Support', 'AgentStatus'),
    integrationDir: path.resolve('integration'),
    claudeHome: path.join(root, '.claude'),
    codexHome: path.join(root, '.codex'),
    geminiHome: path.join(root, '.gemini'),
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
  await assert.rejects(readdir(paths.geminiHome), /ENOENT/, 'No Antigravity, no ~/.gemini');
  // Gemini CLI alone also creates ~/.gemini; that is not Antigravity.
  await mkdir(path.join(paths.geminiHome, 'tmp'), { recursive: true });
  assert.deepEqual(
    (await backend.check()).agents.map((a) => a.agent),
    ['claude', 'codex'],
  );
  await backend.apply();
  assert.deepEqual(await readdir(paths.geminiHome), ['tmp']);
});

test('mac installer: Antigravity hooks keep other named hooks', async () => {
  const { paths, backend } = await setup();
  const config = path.join(paths.geminiHome, 'config');
  await mkdir(config, { recursive: true });
  await mkdir(path.join(paths.geminiHome, 'antigravity'));
  const file = path.join(config, 'hooks.json');
  const lint = { Stop: [{ command: 'echo lint' }] };
  await writeFile(file, JSON.stringify({ lint }));
  const before = await backend.check();
  assert.deepEqual(before.agents[2], { agent: 'antigravity', configured: false });

  await backend.apply();
  const expected = antigravityHooks((event) => macAntigravityCommand(paths.dataDir, event));
  const hooks = await read(file);
  assert.deepEqual(hooks, { lint, 'agent-status': expected });
  assert.deepEqual(expected.Stop, [
    { type: 'command', command: macAntigravityCommand(paths.dataDir, 'Stop'), timeout: 3 },
  ]);
  assert.equal(Object.keys(expected).join(), 'PreInvocation,Stop');
  assert.equal((await readdir(config)).filter((f) => f.endsWith('.bak')).length, 1);
  assert.deepEqual((await backend.check()).agents[2], { agent: 'antigravity', configured: true });
  assert.equal((await backend.check()).needsInstall, false);
  await backend.apply();
  assert.deepEqual(await read(file), hooks, 'Reinstalling keeps one agent-status entry');
});

test('mac installer: Antigravity config dir is created and disabled hooks need setup', async () => {
  const { paths, backend } = await setup();
  await mkdir(path.join(paths.geminiHome, 'antigravity-ide'), { recursive: true });
  await backend.apply();
  const file = path.join(paths.geminiHome, 'config', 'hooks.json');
  const hooks = await read(file);
  assert.ok(hooks['agent-status']);
  await writeFile(
    file,
    JSON.stringify({ 'agent-status': { ...hooks['agent-status'], enabled: false } }),
  );
  const check = await backend.check();
  assert.deepEqual(check.agents[2], { agent: 'antigravity', configured: false });
  assert.equal(check.needsInstall, true);
});

test('mac installer: malformed Antigravity hooks abort without writing', async () => {
  const { paths, backend } = await setup();
  const config = path.join(paths.geminiHome, 'config');
  await mkdir(config, { recursive: true });
  await mkdir(path.join(paths.geminiHome, 'antigravity'));
  await writeFile(path.join(config, 'hooks.json'), '[]');
  await assert.rejects(backend.check(), /hooks\.json/);
  await assert.rejects(backend.apply(), /hooks\.json/);
  await assert.rejects(readFile(path.join(paths.claudeHome, 'settings.json')), /ENOENT/);
  await assert.rejects(readdir(paths.dataDir), /ENOENT/);
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
  assert.match(files[0], /^[a-f0-9-]+\.json$/, 'Lowercase UUID file name');
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
  const { paths } = await setup();
  // bash keeps the symlink name as argv[0]; /bin/sh on macOS is a shim that re-execs a shell.
  // The owner's own path has no space, as when claude is launched from PATH.
  const bin = await mkdtemp(path.join(tmpdir(), 'agent-status-owner-'));
  const fakeClaude = path.join(bin, 'claude');
  await symlink('/bin/bash', fakeClaude);
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  // The trailing `; true` stops bash from exec-ing osascript in place of itself.
  const script = `LC_ALL=C /bin/ps -o lstart= -p $$; /usr/bin/osascript -l JavaScript ${quote(writer)} claude ${quote(paths.dataDir)}; echo "PID=$$"; true`;
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

const antigravity = (dataDir: string, input: string, ...event: string[]) =>
  spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', writer, 'antigravity', dataDir, ...event], {
    input,
    encoding: 'utf8',
  });

test('JXA writer maps an Antigravity payload and prints {}', macOnly, async () => {
  const { paths } = await setup();
  const result = antigravity(
    paths.dataDir,
    JSON.stringify({
      conversationId: 'conv-1',
      workspacePaths: ['/SECRET/workspace'],
      transcriptPath: '/SECRET/transcript.jsonl',
      terminationReason: 'model_stop',
      fullyIdle: true,
    }),
    'Stop',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '{}');
  const dir = path.join(paths.dataDir, 'events', 'antigravity');
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  const text = await readFile(path.join(dir, files[0]), 'utf8');
  assert.doesNotMatch(text, /SECRET/);
  const { timestamp, ...record } = JSON.parse(text);
  assert.deepEqual(record, {
    agent: 'antigravity',
    session_id: 'conv-1',
    hook_event_name: 'Stop',
    source: 'model_stop',
  });
  assert.ok(Math.abs(timestamp - Date.now()) < 60000);
});

test('JXA writer prints {} and records nothing for bad Antigravity input', macOnly, async () => {
  const { paths } = await setup();
  const valid = JSON.stringify({ conversationId: 'conv-1' });
  for (const [input, event] of [
    ['not json', 'PreInvocation'],
    ['{}', 'PreInvocation'],
    [valid, 'PreToolUse'],
    [valid, 'PostToolUse'],
    [valid, undefined],
  ] as const) {
    const result = antigravity(paths.dataDir, input, ...(event ? [event] : []));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{}', `${input} ${event}`);
  }
  await assert.rejects(readdir(path.join(paths.dataDir, 'events')), /ENOENT/);
});

test('JXA writer finds the Antigravity language server owner', macOnly, async () => {
  const { paths } = await setup();
  // The IDE's server lives under "Antigravity IDE.app", a path with a space.
  const bin = path.join(
    await mkdtemp(path.join(tmpdir(), 'agent-status-agy-')),
    'Antigravity IDE.app',
    'bin',
  );
  await mkdir(bin, { recursive: true });
  const server = path.join(bin, 'language_server_macos_arm');
  await symlink('/bin/bash', server);
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const script = `/usr/bin/osascript -l JavaScript ${quote(writer)} antigravity ${quote(paths.dataDir)} PreInvocation; echo; echo "PID=$$"; true`;
  const result = spawnSync(server, ['-c', script], {
    input: JSON.stringify({ conversationId: 'conv-1' }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.split('\n')[0], '{}');
  const pid = Number(/PID=(\d+)/.exec(result.stdout)?.[1]);
  const dir = path.join(paths.dataDir, 'events', 'antigravity');
  const record = JSON.parse(await readFile(path.join(dir, (await readdir(dir))[0]), 'utf8'));
  assert.equal(record.hook_event_name, 'PreInvocation');
  assert.equal(record.owner_pid, pid);
});

test(
  'installed Antigravity command answers {} via sh -c, even without the writer',
  macOnly,
  async () => {
    const { paths, backend } = await setup();
    await mkdir(path.join(paths.geminiHome, 'antigravity'), { recursive: true });
    await backend.apply();
    const hooks = await read(path.join(paths.geminiHome, 'config', 'hooks.json'));
    const command = hooks['agent-status'].Stop[0].command;
    const run = () =>
      spawnSync('/bin/sh', ['-c', command], {
        input: JSON.stringify({ conversationId: 'via-sh', terminationReason: 'error' }),
        encoding: 'utf8',
      });
    const ran = run();
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout, '{}');
    const dir = path.join(paths.dataDir, 'events', 'antigravity');
    const record = JSON.parse(await readFile(path.join(dir, (await readdir(dir))[0]), 'utf8'));
    assert.deepEqual(
      [record.session_id, record.hook_event_name, record.source],
      ['via-sh', 'Stop', 'error'],
    );
    await rename(path.join(paths.dataDir, MAC_WRITER), path.join(paths.dataDir, 'moved.js'));
    const missing = run();
    assert.equal(missing.status, 0);
    assert.equal(missing.stdout, '{}', 'A missing writer still answers with JSON');
  },
);
