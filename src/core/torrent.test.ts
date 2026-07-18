import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildMagnet, MAX_TORRENT_SIZE, parseTorrent } from './torrent';

const V1_BASE64 =
  'ZDg6YW5ub3VuY2UzMzpodHRwczovL2ZhbGxiYWNrLmV4YW1wbGUvYW5ub3VuY2UxMzphbm5vdW5jZS1saXN0bGw0MzpodHRwczovL3RyYWNrZXIuZXhhbXBsZS9hbm5vdW5jZT9wYXNzPWEmeD0xZWwzNTp1ZHA6Ly90cmFja2VyLmV4YW1wbGU6Njk2OS9hbm5vdW5jZWVlNDppbmZvZDY6bGVuZ3RoaTVlNDpuYW1lMTU6aGVsbG8gd29ybGQudHh0MTI6cGllY2UgbGVuZ3RoaTE2Mzg0ZTY6cGllY2VzMjA6AAECAwQFBgcICQoLDA0ODxAREhNlODp1cmwtbGlzdGwyNzpodHRwczovL3NlZWQuZXhhbXBsZS9maWxlcy9lZQ==';
const V2_BASE64 =
  'ZDQ6aW5mb2Q5OmZpbGUgdHJlZWQ5OmVtcHR5LmJpbmQwOmQ2Omxlbmd0aGkwZWVlZTEyOm1ldGEgdmVyc2lvbmkyZTQ6bmFtZTg6djIgZW1wdHkxMjpwaWVjZSBsZW5ndGhpMTYzODRlZTEyOnBpZWNlIGxheWVyc2RlZQ==';
const HYBRID_BASE64 =
  'ZDQ6aW5mb2Q5OmZpbGUgdHJlZWQ5OmVtcHR5LmJpbmQwOmQ2Omxlbmd0aGkwZWVlZTY6bGVuZ3RoaTBlMTI6bWV0YSB2ZXJzaW9uaTJlNDpuYW1lOTplbXB0eS5iaW4xMjpwaWVjZSBsZW5ndGhpMTYzODRlNjpwaWVjZXMwOmUxMjpwaWVjZSBsYXllcnNkZWU=';

const V1_MAGNET =
  'magnet:?xt=urn:btih:06f2906355358abd3b5a5cc60fefe5863fd1ca95&dn=hello%20world.txt&tr=https%3A%2F%2Ftracker.example%2Fannounce%3Fpass%3Da%26x%3D1&tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce&ws=https%3A%2F%2Fseed.example%2Ffiles%2F';
const V2_MAGNET =
  'magnet:?xt=urn:btmh:1220d2b8c6ebcdf02f0704fbe37cb14522ec620ad2bd2fb5d81df259084aa391da16&dn=v2%20empty';
const HYBRID_MAGNET =
  'magnet:?xt=urn:btih:a2cbc9d1534378ef64d1e0619d738b2f3d2b7dd4&xt=urn:btmh:1220882b4b77461bf690ee114e776aa263b6850ea6caf0cfae73a7437e64da8fa8b6&dn=empty.bin';

describe('parseTorrent', () => {
  it('converts a v1 torrent and prefers announce-list over announce', () => {
    const metadata = parseTorrent(fixture(V1_BASE64), 'hello.torrent');

    expect(metadata).toMatchObject({
      sourceFileName: 'hello.torrent',
      name: 'hello world.txt',
      kind: 'v1',
      totalSize: 5n,
      fileCount: 1,
      v1InfoHash: '06f2906355358abd3b5a5cc60fefe5863fd1ca95',
      v2InfoHash: undefined,
      isPrivate: false,
    });
    expect(metadata.trackers).toEqual([
      'https://tracker.example/announce?pass=a&x=1',
      'udp://tracker.example:6969/announce',
    ]);
    expect(metadata.trackers).not.toContain('https://fallback.example/announce');
    expect(metadata.webSeeds).toEqual(['https://seed.example/files/']);
    expect(buildMagnet(metadata)).toBe(V1_MAGNET);
  });

  it('converts a pure v2 torrent', () => {
    const metadata = parseTorrent(fixture(V2_BASE64), 'v2.torrent');

    expect(metadata).toMatchObject({
      name: 'v2 empty',
      kind: 'v2',
      totalSize: 0n,
      fileCount: 1,
      v1InfoHash: undefined,
      v2InfoHash: 'd2b8c6ebcdf02f0704fbe37cb14522ec620ad2bd2fb5d81df259084aa391da16',
    });
    expect(buildMagnet(metadata)).toBe(V2_MAGNET);
  });

  it('converts a hybrid torrent with both exact topics', () => {
    const metadata = parseTorrent(fixture(HYBRID_BASE64), 'hybrid.torrent');

    expect(metadata).toMatchObject({
      name: 'empty.bin',
      kind: 'hybrid',
      totalSize: 0n,
      fileCount: 1,
      v1InfoHash: 'a2cbc9d1534378ef64d1e0619d738b2f3d2b7dd4',
      v2InfoHash: '882b4b77461bf690ee114e776aa263b6850ea6caf0cfae73a7437e64da8fa8b6',
    });
    expect(buildMagnet(metadata)).toBe(HYBRID_MAGNET);
  });

  it('hashes only the original info bytes', () => {
    const originalBytes = fixture(V1_BASE64);
    const changedOuterField = originalBytes.slice();
    const fallbackOffset = indexOfAscii(changedOuterField, 'fallback');
    changedOuterField[fallbackOffset] = 'F'.charCodeAt(0);

    const original = parseTorrent(originalBytes, 'a.torrent');
    const changedOuter = parseTorrent(changedOuterField, 'b.torrent');
    expect(changedOuter.v1InfoHash).toBe(original.v1InfoHash);

    const changedInfo = originalBytes.slice();
    const nameOffset = indexOfAscii(changedInfo, 'hello world.txt');
    changedInfo[nameOffset] = 'H'.charCodeAt(0);
    expect(parseTorrent(changedInfo, 'c.torrent').v1InfoHash).not.toBe(original.v1InfoHash);
  });

  it('accepts a legacy v1 torrent with unsorted keys and hashes its raw info', () => {
    const bytes = new TextEncoder().encode(
      'd4:infod4:name1:x6:lengthi0e12:piece lengthi16384e6:pieces0:ee',
    );
    const metadata = parseTorrent(bytes, 'legacy.torrent');

    expect(metadata.kind).toBe('v1');
    expect(metadata.v1InfoHash).toBe(
      createHash('sha1')
        .update('d4:name1:x6:lengthi0e12:piece lengthi16384e6:pieces0:e')
        .digest('hex'),
    );
  });

  it('rejects unsorted dictionaries for v2 torrents', () => {
    const bytes = new TextEncoder().encode(
      'd4:infod4:name1:x12:meta versioni2ee12:piece layersdee',
    );
    expect(() => parseTorrent(bytes, 'unsorted-v2.torrent')).toThrowError(
      expect.objectContaining({ code: 'unsorted-key' }),
    );
  });

  it('uses independent SHA implementations for the known fixture', () => {
    const bytes = fixture(V1_BASE64);
    const infoStart = indexOfAscii(bytes, 'd6:lengthi5e4:name15:hello world.txt');
    const infoEnd = indexOfAscii(bytes, 'e8:url-list') + 1;
    const expected = createHash('sha1').update(bytes.subarray(infoStart, infoEnd)).digest('hex');
    expect(parseTorrent(bytes, 'known.torrent').v1InfoHash).toBe(expected);
  });

  it('rebuilds a magnet with selected, valid and unique endpoints', () => {
    const metadata = parseTorrent(fixture(V1_BASE64), 'hello.torrent');
    expect(
      buildMagnet(
        metadata,
        [
          'udp://tracker.example:6969/announce',
          'udp://tracker.example:6969/announce',
          'javascript:alert(1)',
        ],
        [],
      ),
    ).toBe(
      'magnet:?xt=urn:btih:06f2906355358abd3b5a5cc60fefe5863fd1ca95&dn=hello%20world.txt&tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce',
    );
  });

  it('uses UTF-8 name, private flag, tracker fallback and stable deduplication', () => {
    const bytes = bencode({
      announce: 'https://fallback.example/announce',
      'announce-list': ['invalid-tier'],
      info: {
        length: 3n,
        name: 'fallback',
        'name.utf-8': '中文.txt',
        'piece length': 16_384n,
        pieces: new Uint8Array(20),
        private: 1n,
      },
      'url-list': [
        'https://seed.example/file',
        'https://seed.example/file',
        'ftp://unsupported.example/file',
      ],
    });
    const metadata = parseTorrent(bytes, 'source.torrent');

    expect(metadata.name).toBe('中文.txt');
    expect(metadata.isPrivate).toBe(true);
    expect(metadata.trackers).toEqual(['https://fallback.example/announce']);
    expect(metadata.webSeeds).toEqual(['https://seed.example/file']);
  });

  it('accepts a multi-file hybrid torrent with BEP 47 padding files', () => {
    const metadata = parseTorrent(
      bencode({
        info: {
          'file tree': {
            'a.bin': {
              '': { length: 10_000n, 'pieces root': new Uint8Array(32) },
            },
            'b.bin': {
              '': { length: 1n, 'pieces root': new Uint8Array(32) },
            },
          },
          files: [
            { length: 10_000n, path: ['a.bin'] },
            { attr: 'p', length: 6_384n },
            { length: 1n, path: ['b.bin'] },
          ],
          'meta version': 2n,
          name: 'bundle',
          'piece length': 16_384n,
          pieces: new Uint8Array(40),
        },
        'piece layers': {},
      }),
      'hybrid-padding.torrent',
    );

    expect(metadata.kind).toBe('hybrid');
    expect(metadata.totalSize).toBe(10_001n);
    expect(metadata.fileCount).toBe(2);
    expect(metadata.v1InfoHash).toMatch(/^[0-9a-f]{40}$/);
    expect(metadata.v2InfoHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts canonical hybrid padding after the final file', () => {
    const metadata = parseTorrent(
      bencode({
        info: {
          'file tree': {
            'a.bin': {
              '': { length: 10_000n, 'pieces root': new Uint8Array(32) },
            },
            'b.bin': {
              '': { length: 1n, 'pieces root': new Uint8Array(32) },
            },
          },
          files: [
            { length: 10_000n, path: ['a.bin'] },
            { attr: 'p', length: 6_384n },
            { length: 1n, path: ['b.bin'] },
            { attr: 'p', length: 16_383n },
          ],
          'meta version': 2n,
          name: 'bundle',
          'piece length': 16_384n,
          pieces: new Uint8Array(40),
        },
        'piece layers': {},
      }),
      'hybrid-tail-padding.torrent',
    );

    expect(metadata.kind).toBe('hybrid');
    expect(metadata.totalSize).toBe(10_001n);
    expect(metadata.fileCount).toBe(2);
  });

  it('accepts a BEP 47 symlink with an omitted length', () => {
    const metadata = parseTorrent(
      bencode({
        info: {
          files: [
            { attr: 'l', path: ['link'], 'symlink path': ['target'] },
            { length: 1n, path: ['target'] },
          ],
          name: 'links',
          'piece length': 16_384n,
          pieces: new Uint8Array(20),
        },
      }),
      'symlink.torrent',
    );

    expect(metadata.kind).toBe('v1');
    expect(metadata.totalSize).toBe(1n);
    expect(metadata.fileCount).toBe(2);
  });

  it('validates a v2 piece layer against its merkle root', () => {
    const firstPiece = new Uint8Array(32).fill(1);
    const secondPiece = new Uint8Array(32).fill(2);
    const layer = Uint8Array.from([...firstPiece, ...secondPiece]);
    const piecesRoot = new Uint8Array(
      createHash('sha256').update(layer).digest(),
    );
    const metadata = parseTorrent(
      bencode({
        info: {
          'file tree': {
            'large.bin': { '': { length: 32_768n, 'pieces root': piecesRoot } },
          },
          'meta version': 2n,
          name: 'large.bin',
          'piece length': 16_384n,
        },
        'piece layers': new Map([[piecesRoot, layer]]),
      }),
      'piece-layer.torrent',
    );

    expect(metadata.kind).toBe('v2');
    expect(metadata.totalSize).toBe(32_768n);
  });

  it.each([
    [
      'unknown meta version',
      {
        info: {
          'file tree': { file: { '': { length: 0n } } },
          'meta version': 3n,
          name: 'x',
          'piece length': 16_384n,
        },
        'piece layers': {},
      },
      'unsupported-meta-version',
    ],
    [
      'bad v1 pieces',
      { info: { length: 1n, name: 'x', 'piece length': 16_384n, pieces: 'short' } },
      'invalid-v1-pieces',
    ],
    [
      'both v1 layouts',
      {
        info: {
          files: [{ length: 1n }],
          length: 1n,
          name: 'x',
          'piece length': 16_384n,
          pieces: new Uint8Array(20),
        },
      },
      'invalid-v1-layout',
    ],
    [
      'negative length',
      { info: { length: -1n, name: 'x', 'piece length': 16_384n, pieces: new Uint8Array() } },
      'invalid-file-length',
    ],
    [
      'missing piece layers',
      {
        info: {
          'file tree': { file: { '': { length: 0n } } },
          'meta version': 2n,
          name: 'x',
          'piece length': 16_384n,
        },
      },
      'missing-piece-layers',
    ],
    [
      'bad v2 piece length',
      {
        info: {
          'file tree': { file: { '': { length: 0n } } },
          'meta version': 2n,
          name: 'x',
          'piece length': 20_000n,
        },
        'piece layers': {},
      },
      'invalid-v2-piece-length',
    ],
    [
      'mismatched hybrid layouts',
      {
        info: {
          'file tree': {
            file: { '': { length: 2n, 'pieces root': new Uint8Array(32) } },
          },
          length: 1n,
          'meta version': 2n,
          name: 'x',
          'piece length': 16_384n,
          pieces: new Uint8Array(20),
        },
        'piece layers': {},
      },
      'hybrid-layout-mismatch',
    ],
    [
      'bad v1 piece count',
      {
        info: {
          length: 32_768n,
          name: 'x',
          'piece length': 16_384n,
          pieces: new Uint8Array(20),
        },
      },
      'invalid-v1-piece-count',
    ],
    [
      'v2 file at tree root',
      {
        info: {
          'file tree': { '': { length: 0n } },
          'meta version': 2n,
          name: 'x',
          'piece length': 16_384n,
        },
        'piece layers': {},
      },
      'invalid-file-tree-leaf',
    ],
    [
      'missing v2 piece layer',
      {
        info: {
          'file tree': {
            file: { '': { length: 32_768n, 'pieces root': new Uint8Array(32) } },
          },
          'meta version': 2n,
          name: 'file',
          'piece length': 16_384n,
        },
        'piece layers': {},
      },
      'invalid-piece-layer',
    ],
    [
      'unaligned hybrid files',
      {
        info: {
          'file tree': {
            a: { '': { length: 1n, 'pieces root': new Uint8Array(32) } },
            b: { '': { length: 1n, 'pieces root': new Uint8Array(32) } },
          },
          files: [
            { length: 1n, path: ['a'] },
            { length: 1n, path: ['b'] },
          ],
          'meta version': 2n,
          name: 'bundle',
          'piece length': 16_384n,
          pieces: new Uint8Array(20),
        },
        'piece layers': {},
      },
      'hybrid-layout-mismatch',
    ],
  ])('rejects %s', (_label, value, code) => {
    expect(() => parseTorrent(bencode(value), 'invalid.torrent')).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('rejects oversized input before parsing', () => {
    expect(() => parseTorrent(new Uint8Array(MAX_TORRENT_SIZE + 1), 'huge.torrent')).toThrowError(
      expect.objectContaining({ code: 'file-too-large' }),
    );
  });
});

function fixture(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function indexOfAscii(bytes: Uint8Array, value: string): number {
  const index = Buffer.from(bytes).indexOf(value, 'utf8');
  if (index < 0) throw new Error(`Could not find ${value}`);
  return index;
}

type Encodable =
  | bigint
  | string
  | Uint8Array
  | Encodable[]
  | Map<string | Uint8Array, Encodable>
  | { [key: string]: Encodable };

function bencode(value: Encodable): Uint8Array {
  if (typeof value === 'bigint') return Buffer.from(`i${value}e`);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  }

  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([key, entryValue]) => ({ key: bencode(key), entryValue }))
      .sort((left, right) => Buffer.from(left.key).compare(Buffer.from(right.key)));
    return Buffer.concat([
      Buffer.from('d'),
      ...entries.flatMap(({ key, entryValue }) => [key, bencode(entryValue)]),
      Buffer.from('e'),
    ]);
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
  return Buffer.concat([
    Buffer.from('d'),
    ...entries.flatMap(([key, entryValue]) => [bencode(key), bencode(entryValue)]),
    Buffer.from('e'),
  ]);
}
