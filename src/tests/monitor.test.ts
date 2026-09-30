const windowsOnly = { skip: process.platform !== 'win32' && 'needs Windows PowerShell' };
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OWNERLESS_TTL_MS, StatusStore, type Agent, type HookEvent } from '../monitor/status';
import { classifyClaude } from '../monitor/claude';
import { classifyCodex } from '../monitor/codex';
import { FileMonitor, parseEvent } from '../monitor/file-monitor';
import { createOwnerProbe, isRunning } from '../monitor/process-owner';

const event = (name: string, extra: Partial<HookEvent> = {}): HookEvent => ({
  agent: 'claude',
  session_id: 'one',
  hook_event_name: name,
  timestamp: Date.now(),
  ...extra,
});

for (const agent of ['claude', 'codex'] as Agent[]) {
  test(`${agent}: lifecycle, approval and recovery`, () => {
    const store = new StatusStore(agent, agent === 'claude' ? classifyClaude : classifyCodex);
    const send = (name: string) => store.accept(event(name, { agent }));
    assert.equal(store.snapshot().observed, false);
    send('SessionStart');
    assert.equal(store.snapshot().status, 'available');
    send('UserPromptSubmit');
    assert.equal(store.snapshot().status, 'working');
    send('PermissionRequest');
    assert.equal(store.snapshot().status, 'stuck');
    send('PostToolUse');
    assert.equal(store.snapshot().status, 'working');
    send('Stop');
    assert.equal(store.snapshot().status, 'available');
    assert.equal(store.snapshot().observed, true, 'A ready session is still active');
    send('SessionEnd');
    assert.equal(store.snapshot().status, 'available');
    assert.equal(store.snapshot().observed, false, 'An ended session must be hidden');
  });
}
test('idle notification and tool failure do not imply intervention', () => {
  const store = new StatusStore('claude', classifyClaude);
  store.accept(event('Stop'));
  store.accept(event('Notification', { notification_type: 'idle_prompt' }));
  assert.equal(store.snapshot().status, 'available');
  store.accept(event('PostToolUseFailure'));
  assert.equal(store.snapshot().status, 'working');
  store.accept(event('StopFailure'));
  assert.equal(store.snapshot().status, 'available');
});
test('input, compaction and interruption', () => {
  assert.equal(
    classifyClaude(event('PreToolUse', { tool_name: 'AskUserQuestion' }))?.status,
    'stuck',
  );
  assert.equal(classifyClaude(event('Elicitation'))?.status, 'stuck');
  assert.equal(classifyClaude(event('ElicitationResult'))?.status, 'working');
  assert.equal(
    classifyCodex(event('PreToolUse', { tool_name: 'request_user_input' }))?.status,
    'stuck',
  );
  assert.equal(
    classifyCodex(event('PreToolUse', { tool_name: 'functions.request_user_input_async' }))?.status,
    'stuck',
  );
  assert.equal(
    classifyCodex(event('preToolUse', { tool_name: 'mcp.request_user_input' }))?.status,
    'stuck',
  );
  assert.equal(classifyCodex(event('Interrupt'))?.status, 'available');
  assert.equal(classifyCodex(event('SessionStart', { source: 'compact' }))?.status, 'working');
});
test('multiple sessions, stale events and recovery', () => {
  const store = new StatusStore('claude', classifyClaude);
  store.accept(event('PermissionRequest', { timestamp: 1000 }));
  store.accept(event('Stop', { session_id: 'two', timestamp: 2000 }));
  assert.equal(store.snapshot().status, 'stuck');
  store.accept(event('PostToolUse', { timestamp: 3000 }));
  store.accept(event('Stop', { timestamp: 500 }));
  assert.equal(store.snapshot().status, 'working');
  store.accept(event('PostToolUse', { timestamp: 64000 }));
  assert.equal(store.snapshot().status, 'working');
  store.accept(event('SessionEnd', { timestamp: 65000 }));
  assert.equal(store.snapshot().status, 'available');
});
test('long thinking or silent work never requests intervention on a timer', () => {
  const store = new StatusStore('claude', classifyClaude);
  store.accept(event('UserPromptSubmit', { timestamp: 1 }));
  assert.equal(store.snapshot().status, 'working');
});
test('an unrelated parallel tool cannot clear an unanswered question', () => {
  const store = new StatusStore('codex', classifyCodex);
  const send = (name: string, extra: Partial<HookEvent> = {}) =>
    store.accept(event(name, { agent: 'codex', ...extra }));
  send('PreToolUse', { tool_name: 'functions.request_user_input', tool_use_id: 'question' });
  send('PreToolUse', { tool_name: 'Bash', tool_use_id: 'command' });
  send('PostToolUse', { tool_name: 'Bash', tool_use_id: 'command' });
  assert.equal(store.snapshot().status, 'stuck');
  const restored = new StatusStore('codex', classifyCodex);
  store
    .events()
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach((e) => restored.accept(e));
  assert.equal(restored.snapshot().status, 'stuck');
  send('PostToolUse', { tool_name: 'functions.request_user_input', tool_use_id: 'question' });
  assert.equal(store.snapshot().status, 'working');
});
test('async questions stay red until the user responds, including after Stop', () => {
  const store = new StatusStore('codex', classifyCodex);
  for (const name of ['PreToolUse', 'PostToolUse', 'Stop']) {
    store.accept(
      event(name, {
        agent: 'codex',
        tool_name: 'request_user_input_async',
        tool_use_id: 'question',
      }),
    );
    assert.equal(store.snapshot().status, 'stuck');
  }
  store.accept(event('UserPromptSubmit', { agent: 'codex' }));
  assert.equal(store.snapshot().status, 'working');
});
test('event validation', () => {
  assert.equal(parseEvent(null), undefined);
  assert.equal(parseEvent(event('Stop', { timestamp: NaN })), undefined);
  assert.equal(parseEvent({ ...event('Stop'), agent: 'unknown' }), undefined);
  assert.equal(parseEvent(event('Stop', { session_id: '' })), undefined);
  assert.equal(parseEvent(event('Stop', { owner_pid: -1, owner_started_at: 1000 })), undefined);
  assert.equal(parseEvent(event('Stop', { owner_pid: 1 })), undefined);
  assert.ok(
    !JSON.stringify(parseEvent({ ...event('Stop'), prompt: 'PRIVATE' })).includes('PRIVATE'),
  );
});
test('real PowerShell writer -> file monitor, private fields removed', windowsOnly, async () => {
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data/integration-'));
  for (const agent of ['claude', 'codex'] as Agent[]) {
    const eventDir = path.join(directory, 'events', agent);
    const monitor = new FileMonitor(
      eventDir,
      agent,
      agent === 'claude' ? classifyClaude : classifyCodex,
    );
    await monitor.poll();
    for (const [name, expected] of [
      ['UserPromptSubmit', 'working'],
      ['PermissionRequest', 'stuck'],
      ['Stop', 'available'],
    ]) {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.resolve('integration/Write-AgentEvent.ps1'),
          '-Agent',
          agent,
          '-DataDir',
          directory,
        ],
        {
          input: JSON.stringify({
            ...event(name, { agent }),
            prompt: 'PRIVATE_PROMPT',
            tool_input: { secret: 'PRIVATE_SECRET' },
          }),
          encoding: 'utf8',
          windowsHide: true,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
      const files = (await readdir(eventDir)).filter((name) => name !== 'state.json');
      assert.equal(files.length, 1);
      const record = await readFile(path.join(eventDir, files[0]), 'utf8');
      assert.ok(!record.includes('PRIVATE'));
      await monitor.poll();
      assert.equal(monitor.snapshot().status, expected);
      assert.deepEqual(await readdir(eventDir), ['state.json']);
    }
    await writeFile(path.join(eventDir, 'abcd.json'), '{');
    await writeFile(path.join(eventDir, 'abcd.tmp'), '{');
    await monitor.poll();
    assert.equal(monitor.snapshot().observed, true);
    assert.deepEqual(await readdir(eventDir), ['abcd.tmp', 'state.json']);
  }
});
test('start after Codex, restart while waiting, and discard dead/reused owners', async () => {
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data/restart-'));
  const owner = { owner_pid: 123, owner_started_at: 1000 };
  let running = true;
  const isAlive = async (pid: number, started: number) =>
    running && pid === owner.owner_pid && started === owner.owner_started_at;
  // Already-running Codex, plus an old blocked session whose PID has been reused.
  await writeFile(
    path.join(directory, 'a.json'),
    JSON.stringify(event('UserPromptSubmit', { agent: 'codex', timestamp: 2000, ...owner })),
  );
  await writeFile(
    path.join(directory, 'b.json'),
    JSON.stringify(
      event('PermissionRequest', {
        agent: 'codex',
        session_id: 'old',
        timestamp: 2000,
        owner_pid: 123,
        owner_started_at: 500,
      }),
    ),
  );
  const first = new FileMonitor(directory, 'codex', classifyCodex, isAlive);
  await first.poll();
  assert.equal(first.snapshot().status, 'working');
  assert.equal(first.snapshot().observed, true);
  await writeFile(
    path.join(directory, 'c.json'),
    JSON.stringify(
      event('PreToolUse', {
        agent: 'codex',
        tool_name: 'request_user_input',
        tool_use_id: 'q',
        timestamp: 3000,
        ...owner,
      }),
    ),
  );
  await writeFile(
    path.join(directory, 'd.json'),
    JSON.stringify(
      event('PostToolUse', {
        agent: 'codex',
        tool_name: 'Bash',
        tool_use_id: 'unrelated',
        timestamp: 4000,
        ...owner,
      }),
    ),
  );
  await first.poll();
  const restarted = new FileMonitor(directory, 'codex', classifyCodex, isAlive);
  await restarted.poll();
  assert.equal(restarted.snapshot().status, 'stuck');
  await writeFile(
    path.join(directory, 'e.json'),
    JSON.stringify(
      event('PostToolUse', {
        agent: 'codex',
        tool_name: 'request_user_input',
        tool_use_id: 'q',
        timestamp: 5000,
        ...owner,
      }),
    ),
  );
  await restarted.poll();
  assert.equal(restarted.snapshot().status, 'working');
  running = false;
  await restarted.poll();
  assert.equal(restarted.snapshot().status, 'available');
  assert.equal(
    restarted.snapshot().observed,
    false,
    'A closed process must be hidden without SessionEnd',
  );
  const afterExit = new FileMonitor(directory, 'codex', classifyCodex, isAlive);
  await afterExit.poll();
  assert.equal(afterExit.snapshot().observed, false);
});
test('source failures retain queued events and recover without inventing a red light', async () => {
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data/recovery-'));
  let failing = true;
  const monitor = new FileMonitor(directory, 'codex', classifyCodex, async () => {
    if (failing) throw new Error('Process inspection unavailable');
    return true;
  });
  await writeFile(
    path.join(directory, 'a.json'),
    JSON.stringify(
      event('UserPromptSubmit', { agent: 'codex', owner_pid: 123, owner_started_at: 1000 }),
    ),
  );
  await monitor.poll();
  assert.equal(monitor.snapshot().observed, false);
  assert.ok((await readdir(directory)).includes('a.json'));
  failing = false;
  await monitor.poll();
  assert.equal(monitor.snapshot().status, 'working');
  assert.equal(monitor.snapshot().observed, true);
});
test('installer merges existing settings and is idempotent', windowsOnly, async () => {
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data/install tiếng Việt-'));
  const claude = path.join(directory, 'claude');
  const codex = path.join(directory, 'codex');
  await mkdir(claude);
  await mkdir(codex);
  await writeFile(
    path.join(claude, 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      language: 'Tiếng Việt',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] },
    }),
  );
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-File',
    path.resolve('integration/Install-Hooks.ps1'),
    '-DataDir',
    path.join(directory, 'data'),
    '-ClaudeHome',
    claude,
    '-CodexHome',
    codex,
  ];
  const preview = spawnSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true });
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(await readdir(codex), []);
  const check = () => {
    const result = spawnSync('powershell.exe', [...args, '-Check'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const before = await readFile(path.join(claude, 'settings.json'), 'utf8');
  assert.equal(check().needsInstall, true);
  assert.equal(await readFile(path.join(claude, 'settings.json'), 'utf8'), before);
  assert.deepEqual(await readdir(codex), []);
  assert.deepEqual(await readdir(directory), ['claude', 'codex']);
  for (let i = 0; i < 2; i++) {
    const result = spawnSync('powershell.exe', [...args, '-Apply'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const settings = JSON.parse(await readFile(path.join(claude, 'settings.json'), 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.language, 'Tiếng Việt');
  assert.equal(settings.hooks.Stop.length, 2);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'echo existing');
  const hooks = JSON.parse(await readFile(path.join(codex, 'hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.Stop.length, 1);
  assert.equal(check().needsInstall, false);
  const installedFiles = await readdir(codex);
  check();
  assert.deepEqual(
    await readdir(codex),
    installedFiles,
    'Startup checks do not create backups or rewrite settings',
  );
  delete hooks.hooks.UserPromptSubmit;
  await writeFile(path.join(codex, 'hooks.json'), JSON.stringify(hooks));
  const missingHook = check();
  assert.equal(missingHook.needsInstall, true);
  assert.equal(
    missingHook.agents.find((agent: { agent: string }) => agent.agent === 'claude').configured,
    true,
  );
  assert.equal(
    missingHook.agents.find((agent: { agent: string }) => agent.agent === 'codex').configured,
    false,
  );
  await writeFile(path.join(directory, 'data/Write-AgentEvent.ps1'), '# old writer');
  assert.equal(check().writerCurrent, false);
});

test(
  'installed hooks preserve CLI ownership within the timeout and tolerate a missing helper',
  windowsOnly,
  async () => {
    await mkdir('.test-data', { recursive: true });
    const directory = await mkdtemp(path.resolve('.test-data/hook-owner-'));
    const data = path.join(directory, 'data');
    const installArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.resolve('integration/Install-Hooks.ps1'),
      '-DataDir',
      data,
      '-ClaudeHome',
      path.join(directory, 'claude'),
      '-CodexHome',
      path.join(directory, 'codex'),
    ];
    const installed = spawnSync('powershell.exe', [...installArgs, '-Apply'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(installed.status, 0, installed.stderr);
    const fixture = path.join(directory, 'claude.exe');
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const compiled = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -Path ${quote(path.resolve('src/tests/fixtures/HookOwner.cs'))} -OutputAssembly ${quote(fixture)} -OutputType ConsoleApplication -ErrorAction Stop`,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);
    await copyFile(fixture, path.join(directory, 'codex.exe'));
    for (const agent of ['claude', 'codex'] as Agent[]) {
      const eventDir = path.join(data, 'events', agent);
      for (const hook of ['PreToolUse', 'UserPromptSubmit']) {
        const result = spawnSync(
          path.join(directory, `${agent}.exe`),
          [path.join(data, 'Write-AgentEvent.ps1'), data, agent],
          {
            input: JSON.stringify(event(hook, { tool_name: 'Bash', tool_use_id: 'test-tool' })),
            encoding: 'utf8',
            windowsHide: true,
            timeout: 3000,
          },
        );
        assert.equal(result.status, 0, result.error?.message || result.stderr);
        assert.equal(result.stderr, '');
        const [pid, started] = result.stdout.trim().split(':').map(Number);
        const files = await readdir(eventDir);
        assert.equal(files.length, 1, 'One complete event is written before the timeout');
        const record = JSON.parse(await readFile(path.join(eventDir, files[0]), 'utf8'));
        assert.equal(record.owner_pid, pid);
        assert.equal(record.owner_started_at, started);
        assert.equal(record.hook_event_name, hook);
        assert.equal(record.tool_use_id, 'test-tool');
        await unlink(path.join(eventDir, files[0]));
      }
    }
    await unlink(path.join(data, 'ProcessOwner.dll'));
    const check = spawnSync('powershell.exe', [...installArgs, '-Check'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).needsInstall, true);
    const fallback = spawnSync(fixture, [path.join(data, 'Write-AgentEvent.ps1'), data, 'claude'], {
      input: JSON.stringify(event('UserPromptSubmit')),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    assert.equal(fallback.status, 0, fallback.error?.message || fallback.stderr);
    assert.equal(fallback.stderr, '');
    const [file] = await readdir(path.join(data, 'events/claude'));
    const record = JSON.parse(await readFile(path.join(data, 'events/claude', file), 'utf8'));
    assert.equal(record.hook_event_name, 'UserPromptSubmit');
    assert.equal(record.owner_pid, undefined, 'Unavailable metadata does not lose the event');
  },
);

test(
  'installer migrates console-hiding hooks without duplicates or changing other hooks/trust',
  windowsOnly,
  async () => {
    await mkdir('.test-data', { recursive: true });
    const directory = await mkdtemp(path.resolve('.test-data/console-hook-'));
    const claude = path.join(directory, 'claude');
    const codex = path.join(directory, 'codex');
    const data = path.join(directory, 'data');
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.resolve('integration/Install-Hooks.ps1'),
      '-DataDir',
      data,
      '-ClaudeHome',
      claude,
      '-CodexHome',
      codex,
    ];
    const run = (mode: string) => {
      const result = spawnSync('powershell.exe', [...args, mode], {
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    run('-Apply');
    const hooksPath = path.join(codex, 'hooks.json');
    const hooks = JSON.parse(await readFile(hooksPath, 'utf8'));
    const safeCommand = hooks.hooks.Stop[0].hooks[0].command;
    for (const groups of Object.values(hooks.hooks) as { hooks: { command: string }[] }[][]) {
      for (const group of groups)
        for (const handler of group.hooks)
          handler.command = handler.command.replace(
            '-NonInteractive -File',
            '-NonInteractive -WindowStyle Hidden -File',
          );
    }
    const unrelated = {
      type: 'command',
      command: 'powershell.exe -WindowStyle Hidden -File "C:\\Other\\hook.ps1"',
    };
    hooks.hooks.Stop[0].hooks.push(unrelated);
    hooks.hooks.Stop.push({ hooks: [{ type: 'command', command: safeCommand }] });
    await writeFile(hooksPath, JSON.stringify(hooks));
    const trust = '[hooks.state]\n# Existing trust must be reviewed by the user after migration.\n';
    await writeFile(path.join(codex, 'config.toml'), trust);
    assert.equal(JSON.parse(run('-Check')).needsInstall, true);
    run('-Apply');
    assert.equal(JSON.parse(run('-Check')).needsInstall, false);
    const migrated = JSON.parse(await readFile(hooksPath, 'utf8'));
    for (const groups of Object.values(migrated.hooks) as { hooks: { command: string }[] }[][]) {
      const own = groups
        .flatMap((group) => group.hooks)
        .filter((handler) => handler.command.includes('Write-AgentEvent.ps1'));
      assert.equal(own.length, 1);
      assert.ok(!own[0].command.includes('-WindowStyle'));
    }
    assert.deepEqual(migrated.hooks.Stop[0].hooks, [unrelated]);
    assert.equal(await readFile(path.join(codex, 'config.toml'), 'utf8'), trust);
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', safeCommand],
      {
        input: JSON.stringify({
          session_id: 'console-regression',
          hook_event_name: 'UserPromptSubmit',
        }),
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const events = await readdir(path.join(data, 'events/codex'));
    assert.equal(events.length, 1, 'The migrated hook still forwards stdin to the writer');
  },
);

test('owner probe verifies start time once and reports exit without spawning a shell', async () => {
  const alive = new Set([123]);
  let lookups = 0;
  const probe = createOwnerProbe(
    (pid) => alive.has(pid),
    async () => {
      lookups++;
      return 1000;
    },
  );
  assert.equal(await probe(123, 1000), true);
  assert.equal(await probe(123, 1000), true);
  assert.equal(await probe(123, 5000), false, 'A reused PID with another start time is dead');
  assert.equal(lookups, 2, 'Each owner is looked up once while it keeps running');
  alive.delete(123);
  assert.equal(await probe(123, 1000), false);
  assert.equal(lookups, 2, 'Exit is detected by the liveness check alone');

  let attempts = 0;
  const flaky = createOwnerProbe(
    () => true,
    async () => {
      if (++attempts === 1) throw new Error('powershell unavailable');
      return 9999;
    },
  );
  assert.equal(await flaky(7, 1000), true, 'A running PID is not dropped when lookup fails');
  assert.equal(await flaky(7, 1000), false, 'A failed lookup is retried, not cached');
  assert.equal(attempts, 2);

  assert.equal(isRunning(process.pid), true);
  assert.equal(isRunning(2 ** 31 - 2), false);
});

test('a hook that misses its owner keeps the session tied to the known owner', async () => {
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data/owner-carry-'));
  let running = true;
  const monitor = new FileMonitor(directory, 'claude', classifyClaude, async () => running);
  const owner = { owner_pid: 123, owner_started_at: 1000 };
  await writeFile(path.join(directory, 'a.json'), JSON.stringify(event('UserPromptSubmit', owner)));
  await monitor.poll();
  await writeFile(
    path.join(directory, 'b.json'),
    JSON.stringify(event('Stop', { timestamp: Date.now() + 1 })),
  );
  await monitor.poll();
  assert.equal(monitor.snapshot().status, 'available');
  running = false;
  await monitor.poll();
  assert.equal(monitor.snapshot().observed, false, 'Exit is detected despite the ownerless event');
});

test('ownerless sessions expire after inactivity, longer while busy', () => {
  const now = Date.now();
  const store = new StatusStore('claude', classifyClaude);
  const owner = { owner_pid: 1, owner_started_at: 1 };
  store.accept(event('Stop', { session_id: 'idle', timestamp: now }));
  store.accept(event('PermissionRequest', { session_id: 'waiting', timestamp: now }));
  store.accept(event('Stop', { session_id: 'owned', timestamp: now, ...owner }));
  const sessions = () => [...new Set(store.events().map((e) => e.session_id))].sort();
  store.expireOwnerless(now + OWNERLESS_TTL_MS.available - 1);
  assert.deepEqual(sessions(), ['idle', 'owned', 'waiting']);
  store.expireOwnerless(now + OWNERLESS_TTL_MS.available + 1);
  assert.deepEqual(sessions(), ['owned', 'waiting'], 'Only the idle ownerless session expires');
  assert.equal(store.snapshot().status, 'stuck');
  store.expireOwnerless(now + OWNERLESS_TTL_MS.stuck + 1);
  assert.deepEqual(sessions(), ['owned'], 'Owned sessions never expire');
});

test('a brief source failure keeps the last state; a persistent one is reported', async () => {
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data/transient-'));
  let failing = false;
  const monitor = new FileMonitor(directory, 'claude', classifyClaude, async () => {
    if (failing) throw new Error('locked');
    return true;
  });
  const owner = { owner_pid: 123, owner_started_at: 1000 };
  await writeFile(path.join(directory, 'a.json'), JSON.stringify(event('UserPromptSubmit', owner)));
  await monitor.poll();
  failing = true;
  await monitor.poll();
  await monitor.poll();
  assert.equal(monitor.snapshot().observed, true, 'Two failed polls do not hide the agent');
  assert.equal(monitor.snapshot().error, undefined);
  await monitor.poll();
  assert.equal(monitor.snapshot().observed, false);
  assert.match(monitor.snapshot().error ?? '', /locked/);
  failing = false;
  await monitor.poll();
  assert.equal(monitor.snapshot().observed, true);
  assert.equal(monitor.snapshot().error, undefined);
});
