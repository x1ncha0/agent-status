import test from 'node:test';
import assert from 'node:assert/strict';
import { fitBounds, restoreBounds } from '../main/window-state';

const work = { x: 0, y: 0, width: 1920, height: 1040 };
test('window settings migrate old positions and preserve resized dimensions', () => {
  assert.deepEqual(restoreBounds({ x: 30, y: 40 }, work), { x: 30, y: 40, width: 110, height: 55 });
  const resized = { x: 200, y: 300, width: 240, height: 120 };
  assert.deepEqual(restoreBounds(resized, work), resized);
  assert.deepEqual(restoreBounds(null, work), { x: 1794, y: 969, width: 110, height: 55 });
});
test('window bounds recover from corrupt settings and removed or smaller displays', () => {
  assert.deepEqual(restoreBounds({ x: 'bad', y: null, width: -1, height: Infinity }, work), restoreBounds(null, work));
  assert.deepEqual(fitBounds({ x: 1900, y: 1030, width: 300, height: 200 }, work),
    { x: 1620, y: 840, width: 300, height: 200 });
  assert.deepEqual(fitBounds({ x: -5000, y: -5000, width: 8000, height: 8000 }, work), work);
  assert.deepEqual(fitBounds({ x: -100, y: 10, width: 1, height: 1 }, { ...work, x: -1920 }),
    { x: -100, y: 10, width: 90, height: 45 });
});
