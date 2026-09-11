import { commonEvent, type Classifier } from './status';
export const classifyCodex: Classifier = event => {
  if (event.hook_event_name === 'Interrupt') return { status: 'available', reason: 'Người dùng đã ngắt turn' };
  const tool = event.tool_name?.replace(/^functions\./i, '').toLowerCase();
  // Codex may report built-in tools with a functions. prefix or a namespace.
  // Keep the question red for both sync and async input tools.
  const isQuestionTool = tool === 'request_user_input' || tool === 'request_user_input_async' ||
    tool?.endsWith('.request_user_input') || tool?.endsWith('.request_user_input_async');
  if (event.hook_event_name.toLowerCase() === 'pretooluse' && isQuestionTool)
    return { status: 'stuck', reason: 'Cần bạn trả lời câu hỏi trong Codex' };
  return commonEvent(event);
};
