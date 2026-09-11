import { mkdir, readdir, readFile, stat, unlink, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { StatusStore, type Agent, type Classifier, type HookEvent, type Monitor } from './status';
import { createOwnerProbe, type OwnerAlive } from './process-owner';

export function parseEvent(value: unknown): HookEvent | undefined {
  if (!value || typeof value !== 'object') return;
  const e = value as Record<string, unknown>;
  if (
    (e.agent !== 'claude' && e.agent !== 'codex') ||
    typeof e.session_id !== 'string' ||
    !e.session_id ||
    e.session_id.length > 256 ||
    typeof e.hook_event_name !== 'string' ||
    typeof e.timestamp !== 'number' ||
    !Number.isFinite(e.timestamp) ||
    e.timestamp < 0 ||
    e.timestamp > Date.now() + 60000
  )
    return;
  const result: HookEvent = {
    agent: e.agent,
    session_id: e.session_id,
    hook_event_name: e.hook_event_name,
    timestamp: e.timestamp,
  };
  for (const key of ['tool_name', 'tool_use_id', 'notification_type', 'source'] as const) {
    if (e[key] !== undefined) {
      if (typeof e[key] !== 'string' || e[key].length > 512) return;
      result[key] = e[key];
    }
  }
  if (e.owner_pid !== undefined || e.owner_started_at !== undefined) {
    if (
      !Number.isSafeInteger(e.owner_pid) ||
      Number(e.owner_pid) <= 0 ||
      !Number.isSafeInteger(e.owner_started_at) ||
      Number(e.owner_started_at) <= 0
    )
      return;
    result.owner_pid = Number(e.owner_pid);
    result.owner_started_at = Number(e.owner_started_at);
  }
  return result;
}

export class FileMonitor implements Monitor {
  private store: StatusStore;
  private busy = false;
  private error = '';
  private startedAt = Date.now();
  private restored = false;
  private saved = '';
  constructor(
    private directory: string,
    agent: Agent,
    classify: Classifier,
    private ownerAlive: OwnerAlive = createOwnerProbe(),
  ) {
    this.store = new StatusStore(agent, classify);
  }
  snapshot() {
    const state = this.store.snapshot();
    return this.error ? { ...state, observed: false, reason: this.error } : state;
  }
  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await mkdir(this.directory, { recursive: true });
      const events: HookEvent[] = [];
      const cacheFile = path.join(this.directory, 'state.json');
      if (!this.restored) {
        try {
          const cached: unknown = JSON.parse(await readFile(cacheFile, 'utf8'));
          if (Array.isArray(cached))
            for (const value of cached) {
              const event = parseEvent(value);
              if (event?.owner_pid) events.push(event);
            }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
            throw error;
        }
      }
      const files = (await readdir(this.directory))
        .filter((name) => /^[a-f0-9-]+\.json$/.test(name))
        .slice(0, 1000);
      const consumed: string[] = [];
      for (const name of files) {
        const file = path.join(this.directory, name);
        try {
          if ((await stat(file)).size <= 8192) {
            const event = parseEvent(JSON.parse(await readFile(file, 'utf8')));
            if (event && (event.owner_pid || event.timestamp >= this.startedAt)) events.push(event);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          if (!(error instanceof SyntaxError)) throw error;
        }
        consumed.push(file);
      }
      const owners = new Map<string, Promise<boolean>>();
      for (const event of [...this.store.events(), ...events])
        if (event.owner_pid) {
          const key = `${event.owner_pid}:${event.owner_started_at}`;
          if (!owners.has(key))
            owners.set(key, this.ownerAlive(event.owner_pid, event.owner_started_at!));
        }
      const alive = new Map(
        await Promise.all([...owners].map(async ([key, result]) => [key, await result] as const)),
      );
      const active = (event: HookEvent) =>
        !event.owner_pid || alive.get(`${event.owner_pid}:${event.owner_started_at}`);
      for (const event of this.store.events())
        if (!active(event)) this.store.forget(event.session_id);
      events
        .sort((a, b) => a.timestamp - b.timestamp)
        .filter(active)
        .forEach((event) => this.store.accept(event));
      const serialized = JSON.stringify(
        this.store
          .events()
          .filter((event) => event.owner_pid && event.hook_event_name !== 'SessionEnd'),
      );
      if (serialized !== this.saved) {
        await writeFile(`${cacheFile}.tmp`, serialized, 'utf8');
        await rename(`${cacheFile}.tmp`, cacheFile);
        this.saved = serialized;
      }
      this.restored = true;
      for (const file of consumed)
        await unlink(file).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      this.error = '';
    } catch (error) {
      this.error = `Không đọc được hook events: ${(error as Error).message}`;
    } finally {
      this.busy = false;
    }
  }
}
