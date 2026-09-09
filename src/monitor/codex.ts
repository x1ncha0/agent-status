import { commonEvent, type Classifier } from './status';
export const classifyCodex: Classifier = event => {
  if (event.hook_event_name === 'Interrupt') return { status: 'available', reason: 'Người dùng đã ngắt turn' };
  if (event.hook_event_name === 'PreToolUse' && event.tool_name === 'request_user_input')
    return { status: 'stuck', reason: 'request_user_input đang cần câu trả lời' };
  return commonEvent(event);
};
