import { mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { StatusStore, type Agent, type Classifier, type HookEvent, type Monitor } from './status';

export function parseEvent(value: unknown): HookEvent | undefined {
  if (!value || typeof value !== 'object') return;
  const e = value as Record<string, unknown>;
  if ((e.agent !== 'claude' && e.agent !== 'codex') || typeof e.session_id !== 'string' || !e.session_id || e.session_id.length > 256 ||
      typeof e.hook_event_name !== 'string' || typeof e.timestamp !== 'number' || !Number.isFinite(e.timestamp) ||
      e.timestamp < 0 || e.timestamp > Date.now() + 60000) return;
  for (const key of ['tool_name', 'notification_type', 'source']) if (e[key] !== undefined && typeof e[key] !== 'string') return;
  return e as unknown as HookEvent;
}

export class FileMonitor implements Monitor {
  private store: StatusStore;
  private busy = false;
  private error = '';
  private startedAt = Date.now();
  constructor(private directory: string, agent: Agent, classify: Classifier, timeoutMs: number) {
    this.store = new StatusStore(agent, classify, timeoutMs);
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
      const files = (await readdir(this.directory)).filter(name => /^[a-f0-9-]+\.json$/.test(name)).slice(0, 1000);
      const events: HookEvent[] = [];
      for (const name of files) {
        const file = path.join(this.directory, name);
        try {
          if ((await stat(file)).size <= 8192) {
            const event = parseEvent(JSON.parse(await readFile(file, 'utf8')));
            // Không suy diễn readiness từ event cũ khi app vừa mở lại.
            if (event && event.timestamp >= this.startedAt) events.push(event);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          if (!(error instanceof SyntaxError)) throw error;
        }
        await unlink(file);
      }
      events.sort((a, b) => a.timestamp - b.timestamp).forEach(event => this.store.accept(event));
      this.error = '';
    } catch (error) { this.error = `Không đọc được hook events: ${(error as Error).message}`; }
    finally { this.busy = false; }
  }
}
