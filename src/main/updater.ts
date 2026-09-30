import { app, BrowserWindow, shell } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, constants, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import {
  updateAsset,
  isNewer,
  parseRelease,
  parseSha256,
  pickAsset,
  type Release,
} from './update-release';
import { createUpdatePopup, type UpdateAction, type UpdateView } from './update-window';

const RELEASES_API = 'https://api.github.com/repos/x1ncha0/agent-status/releases/latest';
const ASSET = updateAsset(process.platform, process.arch);
const LATEST_CLOSE_MS = 4000;
const PROGRESS_MS = 100;
const INSTALL_DELAY_MS = 700;

const portableExe = () =>
  process.platform === 'win32' && app.isPackaged
    ? process.env.PORTABLE_EXECUTABLE_FILE || undefined
    : undefined;
const sibling = (exe: string, suffix: string) => exe.replace(/\.exe$/i, suffix);
const reason = (error: unknown) => (error as Error)?.message || String(error);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Dọn exe cũ và file tải dở còn lại từ lần cập nhật trước. */
export async function cleanupPreviousUpdate(): Promise<void> {
  const exe = portableExe();
  if (!exe) return;
  for (const suffix of ['.old.exe', '.update.exe']) {
    try {
      await rm(sibling(exe, suffix), { force: true });
    } catch (error) {
      console.error('Update cleanup failed:', error);
    }
  }
}

/** Ghi cạnh exe đang chạy để thay thế được; thư mục chỉ đọc thì rơi về Downloads. */
async function chooseTarget(
  version: string,
  asset: string,
): Promise<{ file: string; swap?: string }> {
  const exe = portableExe();
  if (exe) {
    try {
      await access(path.dirname(exe), constants.W_OK);
      return { file: sibling(exe, '.update.exe'), swap: exe };
    } catch {
      /* Thư mục exe không ghi được. */
    }
  }
  return {
    file: path.join(
      app.getPath('downloads'),
      asset.replace(/^AgentStatus/, `AgentStatus-${version}`),
    ),
  };
}

async function download(
  url: string,
  file: string,
  signal: AbortSignal,
  onProgress: (received: number, total: number) => void,
): Promise<string> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/octet-stream' } });
  if (!response.ok || !response.body) throw new Error(`GitHub trả về ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      hash.update(chunk);
      onProgress(received, total);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream),
    meter,
    createWriteStream(file),
    {
      signal,
    },
  );
  return hash.digest('hex');
}

/** Không có checksum hợp lệ thì không cài: file tải về sẽ không được kiểm chứng. */
async function expectedDigest(
  release: Release,
  assetName: string,
  signal: AbortSignal,
): Promise<string> {
  const asset = pickAsset(release.assets, `${assetName}.sha256`);
  if (!asset) throw new Error(`Bản phát hành không có file ${assetName}.sha256 để kiểm tra.`);
  const response = await fetch(asset.url, {
    signal,
    headers: { Accept: 'application/octet-stream' },
  });
  if (!response.ok) throw new Error(`Không tải được checksum: GitHub trả về ${response.status}`);
  const digest = parseSha256(await response.text(), assetName);
  if (!digest) throw new Error(`File ${assetName}.sha256 không hợp lệ.`);
  return digest;
}

/** Windows cho phép rename exe đang chạy, nên đổi tên bản cũ rồi đưa bản mới vào chỗ của nó. */
async function install(stage: string, exe: string): Promise<void> {
  const backup = sibling(exe, '.old.exe');
  await rm(backup, { force: true });
  await rename(exe, backup);
  try {
    await rename(stage, exe);
  } catch (error) {
    await rename(backup, exe).catch(() => {});
    throw error;
  }
  app.relaunch({ execPath: exe, args: [] });
  app.quit();
}

export function createUpdater(win: BrowserWindow) {
  const current = app.getVersion().replace(/^v/i, '');
  let busy = false;
  let controller: AbortController | undefined;
  let release: Release | undefined;
  let saved: string | undefined;
  let last: UpdateView = { phase: 'checking', current };
  const render = (view: Partial<UpdateView> & Pick<UpdateView, 'phase'>, closeIn?: number) => {
    last = { current, version: release?.version, ...view };
    popup.render(last, closeIn);
  };

  const check = async () => {
    if (busy) {
      popup.render(last);
      return;
    }
    busy = true;
    render({ phase: 'checking' });
    try {
      const response = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) throw new Error(`GitHub trả về ${response.status}`);
      release = parseRelease(await response.json());
      if (!release) throw new Error('Không đọc được thông tin bản phát hành.');
      if (isNewer(release.version, current)) render({ phase: 'available' });
      else render({ phase: 'latest' }, LATEST_CLOSE_MS);
    } catch (error) {
      console.error('Update check failed:', error);
      render({ phase: 'error', message: `Không kết nối được GitHub. ${reason(error)}` });
    } finally {
      busy = false;
    }
  };

  const start = async () => {
    if (busy || !release) return;
    if (!ASSET) {
      render({ phase: 'error', message: 'Ch?a c? b?n c?p nh?t t? ??ng cho h? ?i?u h?nh n?y.' });
      return;
    }
    const asset = pickAsset(release.assets, ASSET);
    if (!asset) {
      render({ phase: 'error', message: `Bản phát hành không có file ${ASSET}.` });
      if (release.pageUrl) await shell.openExternal(release.pageUrl);
      return;
    }
    busy = true;
    controller = new AbortController();
    const { signal } = controller;
    const target = await chooseTarget(release.version, ASSET);
    render({ phase: 'downloading', received: 0, total: asset.size });
    let emitted = 0;
    try {
      const expected = await expectedDigest(release, ASSET, signal);
      const digest = await download(asset.url, target.file, signal, (received, total) => {
        const size = total || asset.size;
        const now = Date.now();
        if (now - emitted < PROGRESS_MS && received < size) return;
        emitted = now;
        render({ phase: 'downloading', received, total: size });
      });
      if (expected !== digest) throw new Error('Checksum của file tải về không khớp.');
      if (target.swap) {
        render({ phase: 'installing' });
        await wait(INSTALL_DELAY_MS);
        await install(target.file, target.swap);
        return;
      }
      saved = target.file;
      render({
        phase: 'downloaded',
        // Chỉ nêu tên file và thư mục; đường dẫn đầy đủ mở bằng nút "Mở thư mục".
        message: `Đã lưu ${path.basename(target.file)} vào ${path.basename(path.dirname(target.file))}. Thoát app rồi thay file ${ASSET} bằng file này.`,
      });
    } catch (error) {
      await rm(target.file, { force: true }).catch(() => {});
      if (signal.aborted) popup.close();
      else {
        console.error('Update download failed:', error);
        render({ phase: 'error', message: reason(error) });
      }
    } finally {
      controller = undefined;
      busy = false;
    }
  };

  const handle = async (action: UpdateAction) => {
    if (action === 'download') await start();
    else if (action === 'retry') await check();
    else if (action === 'cancel') controller?.abort();
    else if (action === 'open') {
      if (saved) shell.showItemInFolder(saved);
      popup.close();
    } else {
      controller?.abort();
      popup.close();
    }
  };

  const popup = createUpdatePopup((action) => void handle(action), win);
  return { check: () => void check() };
}
