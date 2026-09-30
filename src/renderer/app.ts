type AgentView = {
  agent: 'claude' | 'codex' | 'antigravity';
  status: 'available' | 'working' | 'stuck';
  observed: boolean;
  reason: string;
};
declare global {
  interface Window {
    agentStatus: {
      get(): Promise<AgentView[]>;
      subscribe(callback: (states: AgentView[]) => void): void;
    };
  }
}
function render(states: AgentView[]): void {
  for (const state of states) {
    const element = document.getElementById(state.agent);
    if (!element) continue;
    element.hidden = !state.observed;
    if (!state.observed) continue;
    const labels = {
      available: 'Xanh: Sẵn sàng / đã xong',
      working: 'Vàng: Đang suy nghĩ / làm việc',
      stuck: 'Đỏ: Cần bạn can thiệp',
    };
    const name = element.lastElementChild!.textContent;
    element.setAttribute('aria-label', `${name}: ${labels[state.status]} — ${state.reason}`);
    element.querySelector('.dot')!.className = `dot ${state.status}`;
  }
  rescale();
}
// Each visible agent needs about 55 DIP at scale 1; two agents fit the original 110 DIP window.
function rescale(): void {
  const { clientWidth: width, clientHeight: height } = document.documentElement;
  const visible = Math.max(2, document.querySelectorAll('.agent:not([hidden])').length);
  const scale = Math.max(1, Math.min(width / (55 * visible), height / 55));
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}
new ResizeObserver(rescale).observe(document.documentElement);

window.agentStatus.subscribe(render);
void window.agentStatus.get().then(render);
export {};
