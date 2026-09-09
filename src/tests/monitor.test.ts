import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { StatusStore, type Agent, type HookEvent } from '../monitor/status';
import { classifyClaude } from '../monitor/claude';
import { classifyCodex } from '../monitor/codex';
import { FileMonitor, parseEvent } from '../monitor/file-monitor';

const event = (name: string, extra: Partial<HookEvent> = {}): HookEvent => ({ agent: 'claude', session_id: 'one', hook_event_name: name, timestamp: Date.now(), ...extra });

for (const agent of ['claude', 'codex'] as Agent[]) {
  test(`${agent}: lifecycle, approval and recovery`, () => {
    const store = new StatusStore(agent, agent === 'claude' ? classifyClaude : classifyCodex);
    const send = (name: string) => store.accept(event(name, { agent }));
    assert.equal(store.snapshot().observed, false);
    send('SessionStart'); assert.equal(store.snapshot().status, 'available');
    send('UserPromptSubmit'); assert.equal(store.snapshot().status, 'working');
    send('PermissionRequest'); assert.equal(store.snapshot().status, 'stuck');
    send('PostToolUse'); assert.equal(store.snapshot().status, 'working');
    send('Stop'); assert.equal(store.snapshot().status, 'available');
    send('SessionEnd'); assert.equal(store.snapshot().status, 'available');
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
  assert.equal(store.snapshot().status, 'stuck');
});
test('input, compaction and interruption', () => {
  assert.equal(classifyClaude(event('PreToolUse', { tool_name: 'AskUserQuestion' }))?.status, 'stuck');
  assert.equal(classifyClaude(event('Elicitation'))?.status, 'stuck');
  assert.equal(classifyClaude(event('ElicitationResult'))?.status, 'working');
  assert.equal(classifyCodex(event('PreToolUse', { tool_name: 'request_user_input' }))?.status, 'stuck');
  assert.equal(classifyCodex(event('Interrupt'))?.status, 'available');
  assert.equal(classifyCodex(event('SessionStart', { source: 'compact' }))?.status, 'working');
});
test('multiple sessions, stale events, timeout and recovery', () => {
  const store = new StatusStore('claude', classifyClaude, 60000);
  store.accept(event('PermissionRequest', { timestamp: 1000 }));
  store.accept(event('Stop', { session_id: 'two', timestamp: 2000 }));
  assert.equal(store.snapshot(2000).status, 'stuck');
  store.accept(event('PostToolUse', { timestamp: 3000 }));
  store.accept(event('Stop', { timestamp: 500 }));
  assert.equal(store.snapshot(4000).status, 'working');
  assert.equal(store.snapshot(63000).status, 'stuck');
  store.accept(event('PostToolUse', { timestamp: 64000 }));
  assert.equal(store.snapshot(64000).status, 'working');
  store.accept(event('SessionEnd', { timestamp: 65000 }));
  assert.equal(store.snapshot(65000).status, 'available');
});
test('timeout disabled does not diagnose a long task', () => {
  const store = new StatusStore('claude', classifyClaude);
  store.accept(event('UserPromptSubmit', { timestamp: 1 }));
  assert.equal(store.snapshot(999999999).status, 'working');
});
test('event validation', () => {
  assert.equal(parseEvent(null), undefined);
  assert.equal(parseEvent(event('Stop', { timestamp: NaN })), undefined);
  assert.equal(parseEvent({ ...event('Stop'), agent: 'unknown' }), undefined);
  assert.equal(parseEvent(event('Stop', { session_id: '' })), undefined);
});
test('real PowerShell writer -> file monitor, private fields removed', async () => {
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data/integration-'));
  for (const agent of ['claude', 'codex'] as Agent[]) {
    const eventDir = path.join(directory, 'events', agent);
    const monitor = new FileMonitor(eventDir, agent, agent === 'claude' ? classifyClaude : classifyCodex, 0);
    await monitor.poll();
    for (const [name, expected] of [['UserPromptSubmit', 'working'], ['PermissionRequest', 'stuck'], ['Stop', 'available']]) {
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.resolve('integration/Write-AgentEvent.ps1'), '-Agent', agent, '-DataDir', directory], {
        input: JSON.stringify({ ...event(name, { agent }), prompt: 'PRIVATE_PROMPT', tool_input: { secret: 'PRIVATE_SECRET' } }), encoding: 'utf8', windowsHide: true
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
      const files = await readdir(eventDir);
      assert.equal(files.length, 1);
      const record = await readFile(path.join(eventDir, files[0]), 'utf8');
      assert.ok(!record.includes('PRIVATE'));
      await monitor.poll();
      assert.equal(monitor.snapshot().status, expected);
      assert.equal((await readdir(eventDir)).length, 0);
    }
    await writeFile(path.join(eventDir, 'abcd.json'), '{');
    await writeFile(path.join(eventDir, 'abcd.tmp'), '{');
    await monitor.poll();
    assert.equal(monitor.snapshot().observed, true);
    assert.deepEqual(await readdir(eventDir), ['abcd.tmp']);
  }
});
test('installer merges existing settings and is idempotent', async () => {
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data/install-'));
  const claude = path.join(directory, 'claude'); const codex = path.join(directory, 'codex');
  await mkdir(claude); await mkdir(codex);
  await writeFile(path.join(claude, 'settings.json'), JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] } }));
  const args = ['-NoProfile', '-NonInteractive', '-File', path.resolve('integration/Install-Hooks.ps1'), '-DataDir', path.join(directory, 'data'), '-ClaudeHome', claude, '-CodexHome', codex];
  const preview = spawnSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true });
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(await readdir(codex), []);
  for (let i = 0; i < 2; i++) {
    const result = spawnSync('powershell.exe', [...args, '-Apply'], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  }
  const settings = JSON.parse(await readFile(path.join(claude, 'settings.json'), 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.hooks.Stop.length, 2);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'echo existing');
  const hooks = JSON.parse(await readFile(path.join(codex, 'hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.Stop.length, 1);
});
