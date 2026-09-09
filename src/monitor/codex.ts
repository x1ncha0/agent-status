import { commonEvent, type Classifier } from './status';
export const classifyCodex: Classifier = event => {
  if (event.hook_event_name === 'Interrupt') return { status: 'available', reason: 'Người dùng đã ngắt turn' };
  const tool = event.tool_name?.replace(/^functions\./, '');
  if (event.hook_event_name === 'PreToolUse' && ['request_user_input', 'request_user_input_async'].includes(tool ?? ''))
    return { status: 'stuck', reason: 'Cần bạn trả lời câu hỏi trong Codex' };
  return commonEvent(event);
};
