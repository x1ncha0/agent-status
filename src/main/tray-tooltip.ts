import type { AgentState } from '../monitor/status';

const LABELS = {
  available: 'Sẵn sàng',
  working: 'Đang suy nghĩ / làm việc',
  stuck: 'Cần bạn can thiệp',
};
// Windows cắt tooltip khay ở 127 ký tự.
const MAX_LENGTH = 127;

export function trayTooltip(states: AgentState[]): string {
  const lines = states.flatMap((state) => {
    if (state.error) return [`${state.agent}: lỗi — ${state.error}`];
    return state.observed ? [`${state.agent}: ${LABELS[state.status]}`] : [];
  });
  return (lines.join('\n') || 'Agent Status: Không có agent đang chạy').slice(0, MAX_LENGTH);
}
