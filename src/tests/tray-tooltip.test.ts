import test from 'node:test';
import assert from 'node:assert/strict';
import { trayTooltip } from '../main/tray-tooltip';
import type { AgentState } from '../monitor/status';

const state = (extra: Partial<AgentState>): AgentState => ({
  agent: 'claude',
  status: 'available',
  observed: true,
  reason: '',
  ...extra,
});

test('tray tooltip lists running agents and source errors', () => {
  assert.equal(
    trayTooltip([state({ status: 'working' }), state({ agent: 'codex', status: 'stuck' })]),
    'Claude: Đang suy nghĩ / làm việc\nCodex: Cần bạn can thiệp',
  );
  assert.equal(
    trayTooltip([state({ observed: false, error: 'EPERM' }), state({ agent: 'codex' })]),
    'Claude: lỗi — EPERM\nCodex: Sẵn sàng',
  );
});

test('tray tooltip names Antigravity', () => {
  assert.equal(
    trayTooltip([state({ agent: 'antigravity', status: 'working' })]),
    'Antigravity: Đang suy nghĩ / làm việc',
  );
});

test('tray tooltip has a fallback and fits the Windows limit', () => {
  assert.equal(
    trayTooltip([state({ observed: false }), state({ agent: 'codex', observed: false })]),
    'Agent Status: Không có agent đang chạy',
  );
  assert.equal(trayTooltip([state({ observed: false, error: 'x'.repeat(500) })]).length, 127);
});
