import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseLstart } from '../monitor/process-owner';
import { defaultDataDir } from '../common/platform';

test('data dir follows the platform convention and honours the override', () => {
  assert.equal(
    defaultDataDir('win32', { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'C:\\Roaming'),
    path.join('C:\\Users\\a\\AppData\\Local', 'AgentStatus'),
  );
  assert.equal(defaultDataDir('win32', {}, '/roaming'), path.join('/roaming', 'AgentStatus'));
  assert.equal(
    defaultDataDir('darwin', { LOCALAPPDATA: 'ignored' }, '/Users/a/Library/Application Support'),
    path.join('/Users/a/Library/Application Support', 'AgentStatus'),
  );
  assert.equal(defaultDataDir('darwin', { AGENT_STATUS_DATA_DIR: '/custom' }, '/x'), '/custom');
});

test('ps lstart output parses as local time, including single-digit days', () => {
  assert.equal(
    parseLstart('Tue Sep 30 10:11:12 2026'),
    new Date(2026, 8, 30, 10, 11, 12).getTime(),
  );
  assert.equal(
    parseLstart('  Wed Oct  1 09:00:00 2026\n'),
    new Date(2026, 9, 1, 9, 0, 0).getTime(),
  );
  assert.equal(parseLstart(''), 0);
  assert.equal(parseLstart('garbage'), 0);
  assert.equal(parseLstart('Tue Xyz 30 10:11:12 2026'), 0);
});
