import { mkdir, readdir, readFile, stat, unlink, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  AGENT_NAMES,
  StatusStore,
  type Agent,
  type Classifier,
  type HookEvent,
  type Monitor,
} from './status';
import { createOwnerProbe, type OwnerAlive } from './process-owner';

export function parseEvent(value: unknown): HookEvent | undefined {
  if (!value || typeof value !== 'object') return;
  const e = value as Record<string, unknown>;
  if (
    typeof e.agent !== 'string' ||
    !Object.hasOwn(AGENT_NAMES, e.agent) ||
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
    agent: e.agent as Agent,
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

// One failed poll (e.g. antivirus briefly locking an event file) must not hide the window.
const FAILURE_THRESHOLD = 3;

export class FileMonitor implements Monitor {
  private store: StatusStore;
  private busy = false;
  private error = '';
  private failures = 0;
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
    return this.failures >= FAILURE_THRESHOLD
      ? { ...state, observed: false, reason: this.error, error: this.error }
      : state;
  }
  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await mkdir(this.directory, { recursive: true });
      const restored = this.restored ? [] : await this.readCache();
      const { events: queued, files } = await this.readQueue();
      const events = [...restored, ...queued];
      const active = await this.resolveOwners([...this.store.events(), ...events]);
      for (const event of this.store.events())
        if (!active(event)) this.store.forget(event.session_id);
      events
        .sort((a, b) => a.timestamp - b.timestamp)
        .filter(active)
        .forEach((event) => this.store.accept(event));
      this.store.expireOwnerless(Date.now());
      await this.writeCache();
      this.restored = true;
      // Delete only after the new state is saved, so a failed poll re-reads the queue.
      for (const file of files)
        await unlink(file).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      this.error = '';
      this.failures = 0;
    } catch (error) {
      this.error = `Không đọc được hook events: ${(error as Error).message}`;
      this.failures++;
    } finally {
      this.busy = false;
    }
  }

  private get cacheFile() {
    return path.join(this.directory, 'state.json');
  }

  /** Owned sessions saved by a previous run, to restore state after a restart. */
  private async readCache(): Promise<HookEvent[]> {
    try {
      const cached: unknown = JSON.parse(await readFile(this.cacheFile, 'utf8'));
      if (!Array.isArray(cached)) return [];
      return cached.map(parseEvent).filter((event) => event?.owner_pid) as HookEvent[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)
        return [];
      throw error;
    }
  }

  /** Event files written by hooks, plus every file to delete once they are applied. */
  private async readQueue(): Promise<{ events: HookEvent[]; files: string[] }> {
    const names = (await readdir(this.directory))
      // macOS hooks name files with NSUUID, which is uppercase.
      .filter((name) => /^[a-f0-9-]+\.json$/i.test(name))
      .slice(0, 1000);
    const events: HookEvent[] = [];
    const files: string[] = [];
    for (const name of names) {
      const file = path.join(this.directory, name);
      try {
        if ((await stat(file)).size <= 8192) {
          const event = parseEvent(JSON.parse(await readFile(file, 'utf8')));
          // Ownerless events from before this run cannot be checked for liveness.
          if (event && (event.owner_pid || event.timestamp >= this.startedAt)) events.push(event);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        if (!(error instanceof SyntaxError)) throw error;
      }
      files.push(file);
    }
    return { events, files };
  }

  /** Checks each distinct owner once and returns whether an event's owner is still running. */
  private async resolveOwners(events: HookEvent[]): Promise<(event: HookEvent) => boolean> {
    const ownerKey = (event: HookEvent) => `${event.owner_pid}:${event.owner_started_at}`;
    const checks = new Map<string, Promise<boolean>>();
    for (const event of events)
      if (event.owner_pid && !checks.has(ownerKey(event)))
        checks.set(ownerKey(event), this.ownerAlive(event.owner_pid, event.owner_started_at!));
    const alive = new Map(
      await Promise.all([...checks].map(async ([key, result]) => [key, await result] as const)),
    );
    return (event) => !event.owner_pid || alive.get(ownerKey(event)) === true;
  }

  private async writeCache(): Promise<void> {
    const serialized = JSON.stringify(
      this.store
        .events()
        .filter((event) => event.owner_pid && event.hook_event_name !== 'SessionEnd'),
    );
    if (serialized === this.saved) return;
    await writeFile(`${this.cacheFile}.tmp`, serialized, 'utf8');
    await rename(`${this.cacheFile}.tmp`, this.cacheFile);
    this.saved = serialized;
  }
}
