import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Agent } from '../monitor/status';
import type { Installation, IntegrationBackend, SetupPaths } from './integration-backend';

export const MAC_WRITER = 'write-agent-event.js';
type CliAgent = Exclude<Agent, 'antigravity'>;
const COMMON = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'Stop',
];
const EVENTS: Record<CliAgent, string[]> = {
  claude: [
    ...COMMON,
    'PostToolUseFailure',
    'StopFailure',
    'Notification',
    'Elicitation',
    'ElicitationResult',
  ],
  codex: [...COMMON, 'Interrupt'],
};

interface Handler {
  type?: unknown;
  command?: unknown;
  [key: string]: unknown;
}
interface Group {
  matcher?: unknown;
  hooks?: Handler[];
  [key: string]: unknown;
}
type Settings = { hooks?: Record<string, Group[]>; [key: string]: unknown };

export function macHookCommand(agent: Agent, dataDir: string): string {
  return `/usr/bin/osascript -l JavaScript "${path.join(dataDir, MAC_WRITER)}" ${agent} "${dataDir}"`;
}

const isOwn = (handler: Handler, agent: Agent) =>
  typeof handler.command === 'string' &&
  handler.command.includes(MAC_WRITER) &&
  new RegExp(`\\s${agent}(\\s|$)`).test(handler.command);

async function readSettings(file: string): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Settings;
  } catch {
    /* Reported below. */
  }
  throw new Error(`Không đọc được ${file}: JSON không hợp lệ.`);
}

/** Same merge rules as Install-Hooks.ps1: drop our handlers, keep every other hook, append ours. */
function merge(settings: Settings, agent: CliAgent, command: string) {
  const hooks = { ...(settings.hooks ?? {}) };
  let configured = true;
  for (const name of EVENTS[agent]) {
    const groups: Group[] = [];
    let found = false;
    for (const group of hooks[name] ?? []) {
      const handlers = Array.isArray(group.hooks) ? group.hooks : [];
      if (
        handlers.some((h) => h.command === command && h.type === 'command') &&
        (!group.matcher || group.matcher === '*')
      )
        found = true;
      const remaining = handlers.filter((h) => !isOwn(h, agent));
      if (remaining.length) groups.push({ ...group, hooks: remaining });
    }
    if (!found) configured = false;
    groups.push({ hooks: [{ type: 'command', command, timeout: 3 }] });
    hooks[name] = groups;
  }
  return { settings: { ...settings, hooks }, configured };
}

const ANTIGRAVITY_KEY = 'agent-status';

/** The entry Agent Status owns in Antigravity's hooks.json; the event name is the last argument. */
export function antigravityHooks(command: string) {
  const handler = (event: string) => ({
    type: 'command',
    command: `${command} ${event}`,
    timeout: 3,
  });
  return {
    PreInvocation: [handler('PreInvocation')],
    PostToolUse: [{ matcher: '*', hooks: [handler('PostToolUse')] }],
    Stop: [handler('Stop')],
  };
}

// Only machines that have run Antigravity get its hooks.
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

const sha256 = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');

export function createMacBackend(paths: SetupPaths): IntegrationBackend {
  const bundled = path.join(paths.integrationDir, 'mac', MAC_WRITER);
  const installed = path.join(paths.dataDir, MAC_WRITER);
  const targets: Record<CliAgent, string> = {
    claude: path.join(paths.claudeHome, 'settings.json'),
    codex: path.join(paths.codexHome, 'hooks.json'),
  };
  // Every file is parsed before anything is written, so a bad file aborts the whole install.
  const plan = async () => {
    const plans: { agent: Agent; target: string; settings: Settings; configured: boolean }[] =
      await Promise.all(
        (['claude', 'codex'] as CliAgent[]).map(async (agent) => ({
          agent,
          target: targets[agent],
          ...merge(await readSettings(targets[agent]), agent, macHookCommand(agent, paths.dataDir)),
        })),
      );
    if (await isDirectory(paths.geminiHome)) {
      const target = path.join(paths.geminiHome, 'config', 'hooks.json');
      const hooks = await readSettings(target);
      const expected = antigravityHooks(macHookCommand('antigravity', paths.dataDir));
      plans.push({
        agent: 'antigravity',
        target,
        settings: { ...hooks, [ANTIGRAVITY_KEY]: expected },
        configured: isDeepStrictEqual(hooks[ANTIGRAVITY_KEY], expected),
      });
    }
    return plans;
  };
  return {
    async check(): Promise<Installation> {
      const plans = await plan();
      let writerCurrent = false;
      try {
        writerCurrent = (await sha256(installed)) === (await sha256(bundled));
      } catch {
        /* Not installed yet. */
      }
      const agents = plans.map(({ agent, configured }) => ({ agent, configured }));
      return {
        writerCurrent,
        agents,
        needsInstall: !writerCurrent || agents.some((a) => !a.configured),
      };
    },
    async apply() {
      const plans = await plan();
      await mkdir(paths.dataDir, { recursive: true });
      await copyFile(bundled, installed);
      for (const { target, settings } of plans) {
        await mkdir(path.dirname(target), { recursive: true });
        try {
          await copyFile(target, `${target}.agent-status-${randomUUID()}.bak`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await writeFile(target, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      }
    },
    files: [bundled],
    writerName: MAC_WRITER,
  };
}
