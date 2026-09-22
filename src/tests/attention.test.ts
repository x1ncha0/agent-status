import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttentionNotifier } from '../main/attention';
import type { Agent, AgentState } from '../monitor/status';

const state = (agent: Agent, status: AgentState['status'], observed = true): AgentState => ({
  agent,
  status,
  observed,
  reason: '',
});

test('attention sounds once on red, ignores repeated polls/reason changes, and rearms after work', () => {
  let sounds = 0;
  const notify = createAttentionNotifier(() => sounds++);
  notify([state('claude', 'available', false)]);
  notify([state('claude', 'available')]);
  notify([state('claude', 'working')]);
  assert.equal(sounds, 0);
  notify([state('claude', 'stuck')]);
  notify([state('claude', 'stuck')]);
  notify([{ ...state('claude', 'stuck'), reason: 'Another pending tool needs input' }]);
  assert.equal(sounds, 1);
  notify([state('claude', 'working')]);
  notify([state('claude', 'stuck')]);
  assert.equal(sounds, 2);
});

test('each agent can alert while the other stays red; simultaneous transitions sound once', () => {
  let sounds = 0;
  const notify = createAttentionNotifier(() => sounds++);
  notify([state('claude', 'stuck'), state('codex', 'working')]);
  notify([state('claude', 'stuck'), state('codex', 'stuck')]);
  assert.equal(sounds, 2);
  notify([state('claude', 'available'), state('codex', 'working')]);
  notify([state('claude', 'stuck'), state('codex', 'stuck')]);
  assert.equal(sounds, 3);
});

test('inactive agents do not sound; restored or newly active waiting agents alert once', () => {
  let sounds = 0;
  const notify = createAttentionNotifier(() => sounds++);
  notify([state('codex', 'stuck', false)]);
  assert.equal(sounds, 0);
  notify([state('codex', 'stuck')]);
  notify([state('codex', 'stuck')]);
  assert.equal(sounds, 1);
  notify([state('codex', 'available', false)]);
  notify([state('codex', 'stuck')]);
  assert.equal(sounds, 2);
});
