import { describe, expect, it } from 'vitest';
import {
  BDictionary,
  decodeUtf8,
  parseTorrentDocument,
} from './bencode';

const encoder = new TextEncoder();
const minimalTorrent = encoder.encode(
  'd4:infod6:lengthi0e4:name1:x12:piece lengthi16384e6:pieces0:ee',
);

describe('parseTorrentDocument', () => {
  it('returns the exact original info byte slice', () => {
    const document = parseTorrentDocument(minimalTorrent);

    expect(document.root).toBeInstanceOf(BDictionary);
    expect(document.info).toBeInstanceOf(BDictionary);
    expect(document.isCanonical).toBe(true);
    expect(decodeUtf8(document.infoBytes)).toBe(
      'd6:lengthi0e4:name1:x12:piece lengthi16384e6:pieces0:e',
    );
    expect(decodeUtf8(document.info.getAscii('name') as Uint8Array)).toBe('x');
  });

  it('parses strict integers, lists, byte strings and binary dictionary keys', () => {
    const binaryKeyDocument = Uint8Array.from([
      ...encoder.encode('d4:infod1:ali-2e0:3:fooee12:piece layersd2:'),
      0xff,
      0xfe,
      ...encoder.encode('0:ee'),
    ]);

    const parsed = parseTorrentDocument(binaryKeyDocument);
    expect(parsed.info.getAscii('a')).toEqual([-2n, new Uint8Array(), encoder.encode('foo')]);
    const pieceLayers = parsed.root.getAscii('piece layers');
    expect(pieceLayers).toBeInstanceOf(BDictionary);
    expect((pieceLayers as BDictionary).entries[0]?.key).toEqual(Uint8Array.from([0xff, 0xfe]));
  });

  it.each([
    ['empty file', new Uint8Array(), 'empty-file'],
    ['non-dictionary root', encoder.encode('le'), 'root-not-dictionary'],
    ['missing info', encoder.encode('de'), 'missing-info'],
    ['trailing data', Uint8Array.from([...minimalTorrent, 0x78]), 'trailing-data'],
    ['duplicate key', encoder.encode('d4:infode4:infodee'), 'duplicate-key'],
    ['non-string dictionary key', encoder.encode('di1e1:xe'), 'non-string-key'],
    ['negative zero', encoder.encode('d4:infod1:xi-0eee'), 'negative-zero'],
    ['integer leading zero', encoder.encode('d4:infod1:xi03eee'), 'integer-leading-zero'],
    ['empty integer', encoder.encode('d4:infod1:xieee'), 'empty-integer'],
    ['invalid integer', encoder.encode('d4:infod1:xi+1eee'), 'invalid-integer'],
    ['unterminated integer', encoder.encode('d4:infod1:xi123'), 'unterminated-integer'],
    ['string length leading zero', encoder.encode('d04:info'), 'string-length-leading-zero'],
    ['invalid string length', encoder.encode('d4:infox'), 'invalid-marker'],
    ['truncated string', encoder.encode('d4:info5:abc'), 'truncated-string'],
    ['unterminated dictionary', encoder.encode('d4:infod1:x1:a'), 'unterminated-dictionary'],
    ['unterminated list', encoder.encode('d4:infol1:a'), 'unterminated-list'],
  ])('rejects %s', (_label, value, code) => {
    expect(() => parseTorrentDocument(value)).toThrowError(expect.objectContaining({ code }));
  });

  it('enforces resource limits', () => {
    expect(() => parseTorrentDocument(minimalTorrent, { maxNodes: 2 })).toThrowError(
      expect.objectContaining({ code: 'node-limit' }),
    );
    expect(() => parseTorrentDocument(minimalTorrent, { maxDictionaryKeyLength: 3 })).toThrowError(
      expect.objectContaining({ code: 'string-limit' }),
    );
    expect(() => parseTorrentDocument(minimalTorrent, { maxByteStringLength: 0 })).toThrowError(
      expect.objectContaining({ code: 'string-limit' }),
    );

    const deep = encoder.encode(`d4:infod1:x${'l'.repeat(65)}0:${'e'.repeat(65)}ee`);
    expect(() => parseTorrentDocument(deep)).toThrowError(
      expect.objectContaining({ code: 'depth-limit' }),
    );
  });

  it('records non-canonical key ordering without losing the raw info bytes', () => {
    const unsorted = encoder.encode(
      'd4:infod4:name1:x6:lengthi0e12:piece lengthi16384e6:pieces0:ee',
    );
    const document = parseTorrentDocument(unsorted);

    expect(document.isCanonical).toBe(false);
    expect(decodeUtf8(document.infoBytes)).toBe(
      'd4:name1:x6:lengthi0e12:piece lengthi16384e6:pieces0:e',
    );
  });
});
