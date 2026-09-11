type AgentView = { agent: 'claude' | 'codex'; status: 'available' | 'working' | 'stuck'; observed: boolean; reason: string };
declare global {
  interface Window { agentStatus: { get(): Promise<AgentView[]>; subscribe(callback: (states: AgentView[]) => void): void } }
}
function render(states: AgentView[]): void {
  for (const state of states) {
    const element = document.getElementById(state.agent);
    if (!element) continue;
    element.hidden = !state.observed;
    const labels = { available: 'Xanh: Sẵn sàng / đã xong', working: 'Vàng: Đang suy nghĩ / làm việc', stuck: 'Đỏ: Cần bạn can thiệp' };
    element.title = `${state.observed ? labels[state.status] : 'Chưa kết nối'} — ${state.reason}`;
    element.setAttribute('aria-label', `${state.agent}: ${element.title}`);
    element.querySelector('.dot')!.className = `dot ${state.observed ? state.status : 'unobserved'}`;
  }
}
const resizeObserver = new ResizeObserver(entries => {
  const { width, height } = entries[0].contentRect;
  const scale = Math.max(1, Math.min(width / 110, height / 55));
  document.documentElement.style.setProperty('--ui-scale', String(scale));
});
resizeObserver.observe(document.documentElement);

window.agentStatus.subscribe(render);
void window.agentStatus.get().then(render);
export {};
