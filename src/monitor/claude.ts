import { commonEvent, type Classifier } from './status';
export const classifyClaude: Classifier = event => {
  if (event.hook_event_name === 'PreToolUse' && event.tool_name === 'AskUserQuestion')
    return { status: 'stuck', reason: 'AskUserQuestion đang cần câu trả lời' };
  if (event.hook_event_name === 'Elicitation') return { status: 'stuck', reason: 'MCP đang yêu cầu input' };
  if (event.hook_event_name === 'ElicitationResult' || event.hook_event_name === 'PostToolUseFailure')
    return { status: 'working', reason: 'Agent có thể tiếp tục xử lý' };
  if (event.hook_event_name === 'StopFailure') return { status: 'available', reason: 'Lượt đã dừng do lỗi API; có thể gửi lại yêu cầu' };
  if (event.hook_event_name === 'Notification') {
    if (['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'].includes(event.notification_type ?? ''))
      return { status: 'stuck', reason: `Notification: ${event.notification_type}` };
    // idle_prompt chỉ là nhắc sau khi hoàn thành, không phải bị kẹt.
    return undefined;
  }
  return commonEvent(event);
};
