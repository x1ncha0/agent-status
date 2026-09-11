export type Agent = 'claude' | 'codex';
export type Status = 'available' | 'working' | 'stuck';
export interface AgentState { agent: Agent; status: Status; observed: boolean; reason: string }
export interface HookEvent {
  agent: Agent; session_id: string; hook_event_name: string; timestamp: number;
  tool_name?: string; tool_use_id?: string; notification_type?: string; source?: string;
  owner_pid?: number; owner_started_at?: number;
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
    case 'PermissionRequest': return { status: 'stuck', reason: 'Cần bạn cấp quyền hoặc từ chối yêu cầu trong agent' };
    case 'Stop': return { status: 'available', reason: 'Đã hoàn thành, sẵn sàng nhận yêu cầu mới' };
  }
}

export class StatusStore {
  private sessions = new Map<string, { transition: Transition; event: HookEvent; pending: Map<string, HookEvent> }>();
  private seen = false;
  constructor(readonly agent: Agent, private classify: Classifier) {}
  forget(sessionId: string): void { this.sessions.delete(sessionId); }
  // Only status metadata is persisted. Pending requests must survive unrelated parallel tools.
  events(): HookEvent[] {
    return [...this.sessions.values()].flatMap(s => [...s.pending.values(), s.event]);
  }
  accept(event: HookEvent): void {
    if (event.agent !== this.agent) return;
    const transition = this.classify(event);
    if (!transition) return;
    const prior = this.sessions.get(event.session_id);
    if (prior && event.timestamp < prior.event.timestamp) return;
    const pending = prior?.pending ?? new Map<string, HookEvent>();
    const name = event.hook_event_name;
    if (['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'StopFailure', 'Interrupt'].includes(name)) pending.clear();
    if (name === 'Stop') for (const [key, request] of pending) {
      if (!request.tool_name?.toLowerCase().endsWith('request_user_input_async')) pending.delete(key);
    }
    if (transition.status === 'stuck') {
      pending.set(event.tool_use_id ? `id:${event.tool_use_id}` : `name:${event.tool_name ?? name}`, event);
    } else if (transition.status === 'working') {
      for (const [key, request] of pending) {
        // This tool returns as soon as it displays the question; its PostToolUse is not an answer.
        if (request.tool_name?.toLowerCase().endsWith('request_user_input_async')) continue;
        const completedTool = name === 'PostToolUse' || name === 'PostToolUseFailure';
        const resolved = request.tool_use_id
          ? completedTool && event.tool_use_id === request.tool_use_id
          : request.tool_name
            ? completedTool && event.tool_name === request.tool_name
            : request.hook_event_name === 'Elicitation' ? name === 'ElicitationResult' : true;
        if (resolved) pending.delete(key);
      }
    }
    this.seen = true;
    this.sessions.set(event.session_id, { transition, event, pending });
  }
  snapshot(): AgentState {
    const rank = { available: 0, working: 1, stuck: 2 };
    let chosen: Transition = { status: 'available', reason: this.seen ? 'Không có task đang chạy được quan sát' : 'Cài hooks và mở session mới' };
    let newest = 0;
    for (const { transition, event, pending } of this.sessions.values()) {
      if (transition.ended) continue;
      const request = pending.values().next().value as HookEvent | undefined;
      const current = request ? this.classify(request)! : transition;
      const timestamp = event.timestamp;
      if (rank[current.status] > rank[chosen.status] || (rank[current.status] === rank[chosen.status] && timestamp > newest)) {
        chosen = current; newest = timestamp;
      }
    }
    const observed = this.seen && [...this.sessions.values()].some(session => !session.transition.ended);
    return { agent: this.agent, status: chosen.status, observed, reason: observed ? chosen.reason : 'No active session' };
  }
}
