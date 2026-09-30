import type { Classifier } from './status';
// Antigravity has no permission or question event, so it is never shown as stuck.
export const classifyAntigravity: Classifier = (event) => {
  switch (event.hook_event_name) {
    case 'PreInvocation':
      return { status: 'working', reason: 'Đang suy nghĩ' };
    case 'PostToolUse':
      return { status: 'working', reason: 'Đang chạy tool' };
    case 'Stop':
      return event.source === 'error'
        ? { status: 'available', reason: 'Đã dừng do lỗi' }
        : { status: 'available', reason: 'Đã hoàn thành, sẵn sàng nhận yêu cầu mới' };
  }
};
