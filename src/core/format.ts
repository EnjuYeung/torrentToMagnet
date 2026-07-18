import type { TorrentKind } from './torrent';

const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'] as const;

export function formatBytes(value: bigint): string {
  if (value < 1024n) return `${value} B`;

  let unitIndex = 0;
  let unitSize = 1n;
  while (unitIndex < units.length - 1 && value >= unitSize * 1024n) {
    unitIndex += 1;
    unitSize *= 1024n;
  }

  const tenths = (value * 10n) / unitSize;
  const whole = tenths / 10n;
  const decimal = tenths % 10n;
  return decimal === 0n
    ? `${whole} ${units[unitIndex]}`
    : `${whole}.${decimal} ${units[unitIndex]}`;
}

export function formatFileCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function kindLabel(kind: TorrentKind): string {
  if (kind === 'v1') return 'BitTorrent v1';
  if (kind === 'v2') return 'BitTorrent v2';
  return '混合种子';
}
