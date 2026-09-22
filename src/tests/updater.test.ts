import test from 'node:test';
import assert from 'node:assert/strict';
import { isNewer, parseRelease, parseSha256, pickAsset } from '../main/update-release';
import { cornerBounds } from '../main/window-state';

const payload = {
  tag_name: 'v1.0.7',
  html_url: 'https://github.com/x1ncha0/agent-status/releases/tag/v1.0.7',
  assets: [
    { name: 'AgentStatus.exe', browser_download_url: 'https://example.test/exe', size: 90 },
    { name: 'AgentStatus.exe.sha256', browser_download_url: 'https://example.test/sum', size: 75 },
  ],
};

test('release payloads are normalized and rejected when unusable', () => {
  assert.deepEqual(parseRelease(payload), {
    tag: 'v1.0.7',
    version: '1.0.7',
    pageUrl: payload.html_url,
    assets: [
      { name: 'AgentStatus.exe', url: 'https://example.test/exe', size: 90 },
      { name: 'AgentStatus.exe.sha256', url: 'https://example.test/sum', size: 75 },
    ],
  });
  assert.deepEqual(parseRelease({ ...payload, assets: undefined })?.assets, []);
  assert.equal(parseRelease({ html_url: 'https://example.test' }), undefined);
  assert.equal(parseRelease(null), undefined);
});

test('version comparison ignores tag prefixes and orders numerically', () => {
  assert.equal(isNewer('1.0.7', '1.0.6'), true);
  assert.equal(isNewer('v1.0.10', '1.0.9'), true);
  assert.equal(isNewer('1.1.0', '1.0.99'), true);
  assert.equal(isNewer('2.0', '1.9.9'), true);
  assert.equal(isNewer('1.0.6', '1.0.6'), false);
  assert.equal(isNewer('1.0.5', '1.0.6'), false);
  assert.equal(isNewer('1.0.6', '1.0.6.1'), false);
  assert.equal(isNewer('', '1.0.6'), false);
  assert.equal(isNewer('broken', '1.0.6'), false);
});

test('assets are matched by name without case sensitivity', () => {
  const assets = parseRelease(payload)!.assets;
  assert.equal(pickAsset(assets, 'agentstatus.exe')?.url, 'https://example.test/exe');
  assert.equal(pickAsset(assets, 'AgentStatus.exe.sha256')?.size, 75);
  assert.equal(pickAsset(assets, 'AgentStatus.zip'), undefined);
  assert.equal(pickAsset([], 'AgentStatus.exe'), undefined);
});

test('checksum files are parsed for the matching entry only', () => {
  const digest = 'a'.repeat(64);
  assert.equal(parseSha256(`${digest}  AgentStatus.exe\n`, 'AgentStatus.exe'), digest);
  assert.equal(parseSha256(`${digest} *agentstatus.exe`, 'AgentStatus.exe'), digest);
  assert.equal(parseSha256(`${digest.toUpperCase()}\n`, 'AgentStatus.exe'), digest);
  assert.equal(
    parseSha256(`${'b'.repeat(64)}  other.exe\n${digest}  AgentStatus.exe`, 'AgentStatus.exe'),
    digest,
  );
  assert.equal(parseSha256(`${'b'.repeat(64)}  other.exe`, 'AgentStatus.exe'), undefined);
  assert.equal(parseSha256('not a checksum', 'AgentStatus.exe'), undefined);
});

test('popup anchors to the bottom-right corner of the work area', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(cornerBounds({ width: 360, height: 132 }, work), {
    x: 1548,
    y: 896,
    width: 360,
    height: 132,
  });
  assert.deepEqual(cornerBounds({ width: 360, height: 132 }, { ...work, x: -1920, y: 200 }), {
    x: -372,
    y: 1096,
    width: 360,
    height: 132,
  });
  assert.deepEqual(
    cornerBounds({ width: 360, height: 132 }, { x: 0, y: 0, width: 300, height: 90 }),
    {
      x: 0,
      y: 0,
      width: 300,
      height: 90,
    },
  );
});
