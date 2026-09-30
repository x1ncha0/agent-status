import type { Classifier } from './status';

// terminationReason values are enum names (NO_TOOL_CALL, ERROR, USER_CANCELED, ...).
const STOP_REASONS = new Map([
  ['error', 'Đã dừng do lỗi'],
  ['user_canceled', 'Đã huỷ'],
  ['max_invocations', 'Đã dừng vì chạm giới hạn bước'],
]);

// Antigravity has no permission or question event, so it is never shown as stuck.
export const classifyAntigravity: Classifier = (event) => {
  switch (event.hook_event_name) {
    case 'PreInvocation':
      return { status: 'working', reason: 'Đang suy nghĩ / làm việc' };
    case 'Stop':
      return {
        status: 'available',
        reason:
          STOP_REASONS.get(event.source?.toLowerCase() ?? '') ??
          'Đã hoàn thành, sẵn sàng nhận yêu cầu mới',
      };
  }
};
