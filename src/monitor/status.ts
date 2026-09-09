export type Agent = 'claude' | 'codex';
export type Status = 'available' | 'working' | 'stuck';
export interface AgentState { agent: Agent; status: Status; observed: boolean; reason: string }
export interface HookEvent {
  agent: Agent; session_id: string; hook_event_name: string; timestamp: number;
  tool_name?: string; notification_type?: string; source?: string;
}
export interface Transition { status: Status; reason: string; ended?: boolean }
export type Classifier = (event: HookEvent) => Transition | undefined;
export interface Monitor { snapshot(): AgentState; poll(): Promise<void>; }

export function commonEvent(event: HookEvent): Transition | undefined {
  switch (event.hook_event_name) {
    case 'SessionEnd': return { status: 'available', reason: 'Session đã kết thúc', ended: true };
    case 'SessionStart': return event.source === 'compact'
      ? { status: 'working', reason: 'Đang tiếp tục sau compaction' }
      : { status: 'available', reason: 'Session đã bắt đầu' };
    case 'UserPromptSubmit': return { status: 'working', reason: 'Đã nhận prompt' };
    case 'PreToolUse': case 'PostToolUse': case 'PreCompact': case 'PostCompact':
      return { status: 'working', reason: event.hook_event_name };
    case 'PermissionRequest': return { status: 'stuck', reason: 'Có yêu cầu approval; chờ event tiếp theo' };
    case 'Stop': return { status: 'available', reason: 'Đã nhận Stop' };
  }
}

export class StatusStore {
  private sessions = new Map<string, { transition: Transition; timestamp: number }>();
  private seen = false;
  constructor(readonly agent: Agent, private classify: Classifier, private timeoutMs = 0) {}
  accept(event: HookEvent): void {
    if (event.agent !== this.agent) return;
    const transition = this.classify(event);
    if (!transition) return;
    const prior = this.sessions.get(event.session_id);
    if (prior && event.timestamp < prior.timestamp) return;
    this.seen = true;
    this.sessions.set(event.session_id, { transition, timestamp: event.timestamp });
  }
  snapshot(now = Date.now()): AgentState {
    const rank = { available: 0, working: 1, stuck: 2 };
    let chosen: Transition = { status: 'available', reason: this.seen ? 'Không có task đang chạy được quan sát' : 'Cài hooks và mở session mới' };
    let newest = 0;
    for (const { transition, timestamp } of this.sessions.values()) {
      if (transition.ended) continue;
      const current: Transition = transition.status === 'working' && this.timeoutMs > 0 && now - timestamp >= this.timeoutMs
        ? { status: 'stuck', reason: `Không có hook event trong ${this.timeoutMs / 60000} phút (suy đoán timeout)` }
        : transition;
      if (rank[current.status] > rank[chosen.status] || (rank[current.status] === rank[chosen.status] && timestamp > newest)) {
        chosen = current; newest = timestamp;
      }
    }
    return { agent: this.agent, status: chosen.status, observed: this.seen, reason: chosen.reason };
  }
}
