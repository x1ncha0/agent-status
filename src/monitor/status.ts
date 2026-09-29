export type Agent = 'claude' | 'codex';
type Status = 'available' | 'working' | 'stuck';
export interface AgentState {
  agent: Agent;
  status: Status;
  observed: boolean;
  reason: string;
}
export interface HookEvent {
  agent: Agent;
  session_id: string;
  hook_event_name: string;
  timestamp: number;
  tool_name?: string;
  tool_use_id?: string;
  notification_type?: string;
  source?: string;
  owner_pid?: number;
  owner_started_at?: number;
}
interface Transition {
  status: Status;
  reason: string;
  ended?: boolean;
}
export type Classifier = (event: HookEvent) => Transition | undefined;
export interface Monitor {
  snapshot(): AgentState;
  poll(): Promise<void>;
}

export function commonEvent(event: HookEvent): Transition | undefined {
  switch (event.hook_event_name) {
    case 'SessionEnd':
      return { status: 'available', reason: 'Session đã kết thúc', ended: true };
    case 'SessionStart':
      return event.source === 'compact'
        ? { status: 'working', reason: 'Đang tiếp tục sau compaction' }
        : { status: 'available', reason: 'Session đã bắt đầu' };
    case 'UserPromptSubmit':
      return { status: 'working', reason: 'Đã nhận prompt' };
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PreCompact':
    case 'PostCompact':
      return { status: 'working', reason: event.hook_event_name };
    case 'PermissionRequest':
      return { status: 'stuck', reason: 'Cần bạn cấp quyền hoặc từ chối yêu cầu trong agent' };
    case 'Stop':
      return { status: 'available', reason: 'Đã hoàn thành, sẵn sàng nhận yêu cầu mới' };
  }
}

// Idle sessions expire quickly; busy or waiting ones get time for long tools and absent users.
export const OWNERLESS_TTL_MS: Record<Status, number> = {
  available: 10 * 60_000,
  working: 60 * 60_000,
  stuck: 60 * 60_000,
};

export class StatusStore {
  private sessions = new Map<
    string,
    { transition: Transition; event: HookEvent; pending: Map<string, HookEvent> }
  >();
  constructor(
    private readonly agent: Agent,
    private classify: Classifier,
  ) {}
  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
  // Without an owner process, liveness is unknown and a missed SessionEnd would keep the
  // session forever. Drop it after inactivity; a later hook event brings it back.
  expireOwnerless(now: number): void {
    for (const [id, { transition, event, pending }] of this.sessions) {
      if (event.owner_pid) continue;
      const request = pending.values().next().value as HookEvent | undefined;
      const status = transition.ended
        ? 'available'
        : request
          ? this.classify(request)!.status
          : transition.status;
      if (now - event.timestamp > OWNERLESS_TTL_MS[status]) this.sessions.delete(id);
    }
  }
  // Only status metadata is persisted. Pending requests must survive unrelated parallel tools.
  events(): HookEvent[] {
    return [...this.sessions.values()].flatMap((s) => [...s.pending.values(), s.event]);
  }
  accept(event: HookEvent): void {
    if (event.agent !== this.agent) return;
    const transition = this.classify(event);
    if (!transition) return;
    const prior = this.sessions.get(event.session_id);
    if (prior && event.timestamp < prior.event.timestamp) return;
    // A hook can fail to resolve its owner (e.g. WMI timeout); keep the session's known owner
    // so its exit is still detected.
    if (!event.owner_pid && prior?.event.owner_pid)
      event = {
        ...event,
        owner_pid: prior.event.owner_pid,
        owner_started_at: prior.event.owner_started_at,
      };
    const pending = prior?.pending ?? new Map<string, HookEvent>();
    const name = event.hook_event_name;
    if (
      ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'StopFailure', 'Interrupt'].includes(name)
    )
      pending.clear();
    if (name === 'Stop')
      for (const [key, request] of pending) {
        if (!request.tool_name?.toLowerCase().endsWith('request_user_input_async'))
          pending.delete(key);
      }
    if (transition.status === 'stuck') {
      pending.set(
        event.tool_use_id ? `id:${event.tool_use_id}` : `name:${event.tool_name ?? name}`,
        event,
      );
    } else if (transition.status === 'working') {
      for (const [key, request] of pending) {
        // This tool returns as soon as it displays the question; its PostToolUse is not an answer.
        if (request.tool_name?.toLowerCase().endsWith('request_user_input_async')) continue;
        const completedTool = name === 'PostToolUse' || name === 'PostToolUseFailure';
        const resolved = request.tool_use_id
          ? completedTool && event.tool_use_id === request.tool_use_id
          : request.tool_name
            ? completedTool && event.tool_name === request.tool_name
            : request.hook_event_name === 'Elicitation'
              ? name === 'ElicitationResult'
              : true;
        if (resolved) pending.delete(key);
      }
    }
    this.sessions.set(event.session_id, { transition, event, pending });
  }
  snapshot(): AgentState {
    const rank = { available: 0, working: 1, stuck: 2 };
    let chosen: Transition | undefined;
    let newest = 0;
    for (const { transition, event, pending } of this.sessions.values()) {
      if (transition.ended) continue;
      const request = pending.values().next().value as HookEvent | undefined;
      const current = request ? this.classify(request)! : transition;
      const timestamp = event.timestamp;
      if (
        !chosen ||
        rank[current.status] > rank[chosen.status] ||
        (rank[current.status] === rank[chosen.status] && timestamp > newest)
      ) {
        chosen = current;
        newest = timestamp;
      }
    }
    return {
      agent: this.agent,
      status: chosen?.status ?? 'available',
      observed: chosen !== undefined,
      reason: chosen?.reason ?? 'No active session',
    };
  }
}
