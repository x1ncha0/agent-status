import type { Agent, AgentState } from '../monitor/status';

export function createAttentionNotifier(play: () => void) {
  let waiting = new Set<Agent>();
  return (states: AgentState[]) => {
    const next = new Set(
      states
        .filter((state) => state.observed && state.status === 'stuck')
        .map((state) => state.agent),
    );
    const entered = [...next].some((agent) => !waiting.has(agent));
    waiting = next;
    // Coalesce simultaneous transitions and do not repeat for reason/poll updates.
    if (entered) play();
  };
}
