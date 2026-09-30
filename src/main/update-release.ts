export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}
export interface Release {
  tag: string;
  version: string;
  pageUrl: string;
  assets: ReleaseAsset[];
}

function segments(version: string): number[] | undefined {
  const parts = version
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .filter((part) => /^\d+$/.test(part))
    .map(Number);
  return parts.length ? parts : undefined;
}

export function parseRelease(payload: unknown): Release | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const release = payload as {
    tag_name?: unknown;
    html_url?: unknown;
    assets?: unknown;
  };
  const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
  if (!segments(tag)) return undefined;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return {
    tag,
    version: tag.replace(/^v/i, ''),
    pageUrl: typeof release.html_url === 'string' ? release.html_url : '',
    assets: assets.flatMap((entry) => {
      const asset = entry as { name?: unknown; browser_download_url?: unknown; size?: unknown };
      if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string')
        return [];
      return [
        {
          name: asset.name,
          url: asset.browser_download_url,
          size: Number.isSafeInteger(asset.size) ? (asset.size as number) : 0,
        },
      ];
    }),
  };
}

export function isNewer(latest: string, current: string): boolean {
  const next = segments(latest);
  const now = segments(current);
  if (!next || !now) return false;
  for (let index = 0; index < Math.max(next.length, now.length); index += 1) {
    const difference = (next[index] ?? 0) - (now[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export function pickAsset(assets: ReleaseAsset[], name: string): ReleaseAsset | undefined {
  return assets.find((asset) => asset.name.toLowerCase() === name.toLowerCase());
}

export function parseSha256(text: string, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})(?:\s+\*?(\S.*))?$/i.exec(line.trim());
    if (!match) continue;
    const file = (match[2] || '').trim().toLowerCase();
    if (!file || file === target) return match[1].toLowerCase();
  }
  return undefined;
}

/** Release file this build updates from; undefined when no build is published for it. */
export function updateAsset(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === 'win32') return 'AgentStatus.exe';
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64'))
    return `AgentStatus-mac-${arch}.dmg`;
  return undefined;
}
