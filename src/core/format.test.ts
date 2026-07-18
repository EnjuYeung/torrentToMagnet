import { describe, expect, it } from 'vitest';
import { formatBytes, formatFileCount, kindLabel } from './format';

describe('display formatters', () => {
  it.each([
    [0n, '0 B'],
    [1023n, '1023 B'],
    [1024n, '1 KiB'],
    [1536n, '1.5 KiB'],
    [5n * 1024n * 1024n, '5 MiB'],
    [3n * 1024n * 1024n * 1024n + 512n * 1024n * 1024n, '3.5 GiB'],
  ])('formats %s bytes', (value, expected) => {
    expect(formatBytes(value)).toBe(expected);
  });

  it('formats file counts for Chinese readers', () => {
    expect(formatFileCount(12_345)).toBe('12,345');
  });

  it('labels every torrent kind', () => {
    expect(kindLabel('v1')).toBe('BitTorrent v1');
    expect(kindLabel('v2')).toBe('BitTorrent v2');
    expect(kindLabel('hybrid')).toBe('混合种子');
  });
});
