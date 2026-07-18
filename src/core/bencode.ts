export type BValue = bigint | Uint8Array | BValue[] | BDictionary;

export interface BDictionaryEntry {
  readonly key: Uint8Array;
  readonly value: BValue;
}

export class BDictionary {
  constructor(readonly entries: readonly BDictionaryEntry[]) {}

  getAscii(key: string): BValue | undefined {
    return this.entries.find((entry) => bytesEqualAscii(entry.key, key))?.value;
  }

  hasAscii(key: string): boolean {
    return this.entries.some((entry) => bytesEqualAscii(entry.key, key));
  }
}

export class TorrentFormatError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TorrentFormatError';
  }
}

export interface BencodeLimits {
  maxDepth: number;
  maxNodes: number;
  maxByteStringLength: number;
  maxDictionaryKeyLength: number;
}

export interface TorrentDocument {
  readonly root: BDictionary;
  readonly info: BDictionary;
  readonly infoBytes: Uint8Array;
  readonly isCanonical: boolean;
}

const DEFAULT_LIMITS: BencodeLimits = {
  maxDepth: 64,
  maxNodes: 100_000,
  maxByteStringLength: 20 * 1024 * 1024,
  maxDictionaryKeyLength: 4096,
};

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

export function decodeUtf8(value: Uint8Array): string {
  return utf8Decoder.decode(value);
}

export function parseTorrentDocument(
  bytes: Uint8Array,
  limits: Partial<BencodeLimits> = {},
): TorrentDocument {
  if (bytes.byteLength === 0) {
    throw new TorrentFormatError('empty-file', '种子文件为空。');
  }

  const parser = new BencodeParser(bytes, { ...DEFAULT_LIMITS, ...limits });
  return parser.parseTorrent();
}

class BencodeParser {
  private offset = 0;
  private nodes = 0;
  private infoRange: { start: number; end: number } | undefined;
  private isCanonical = true;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly limits: BencodeLimits,
  ) {}

  parseTorrent(): TorrentDocument {
    const rootValue = this.parseValue(0, true);
    if (!(rootValue instanceof BDictionary)) {
      this.fail('root-not-dictionary', '种子文件的顶层结构必须是字典。');
    }
    if (this.offset !== this.bytes.length) {
      this.fail('trailing-data', '种子文件末尾包含多余数据。');
    }

    const infoValue = rootValue.getAscii('info');
    if (!(infoValue instanceof BDictionary) || !this.infoRange) {
      this.fail('missing-info', '种子文件缺少有效的 info 字典。');
    }

    return {
      root: rootValue,
      info: infoValue,
      infoBytes: this.bytes.subarray(this.infoRange.start, this.infoRange.end),
      isCanonical: this.isCanonical,
    };
  }

  private parseValue(depth: number, captureRootInfo = false): BValue {
    if (depth > this.limits.maxDepth) {
      this.fail('depth-limit', '种子文件的嵌套层级过深。');
    }
    this.consumeNode();

    const marker = this.peek();
    if (marker === 0x69) return this.parseInteger(); // i
    if (marker === 0x6c) return this.parseList(depth); // l
    if (marker === 0x64) return this.parseDictionary(depth, captureRootInfo); // d
    if (marker >= 0x30 && marker <= 0x39) return this.parseByteString();

    this.fail('invalid-marker', `偏移 ${this.offset} 处不是有效的 Bencode 值。`);
  }

  private parseInteger(): bigint {
    this.offset += 1;
    const start = this.offset;

    while (this.offset < this.bytes.length && this.bytes[this.offset] !== 0x65) {
      if (this.offset - start > 128) {
        this.fail('integer-too-long', '种子文件包含异常长的整数。');
      }
      this.offset += 1;
    }

    if (this.offset >= this.bytes.length) {
      this.fail('unterminated-integer', '种子文件包含未结束的整数。');
    }

    const token = this.bytes.subarray(start, this.offset);
    this.offset += 1;
    if (token.length === 0) {
      this.fail('empty-integer', '种子文件包含空整数。');
    }

    let digitStart = 0;
    if (token[0] === 0x2d) {
      digitStart = 1;
      if (token.length === 1) {
        this.fail('invalid-integer', '种子文件包含无效的整数。');
      }
    }

    if (token[digitStart] === 0x30 && token.length - digitStart > 1) {
      this.fail('integer-leading-zero', '种子文件的整数包含前导零。');
    }
    if (token[0] === 0x2d && token[1] === 0x30) {
      this.fail('negative-zero', '种子文件包含无效的负零。');
    }

    for (let index = digitStart; index < token.length; index += 1) {
      const byte = token[index];
      if (byte === undefined || byte < 0x30 || byte > 0x39) {
        this.fail('invalid-integer', '种子文件包含无效的整数。');
      }
    }

    return BigInt(asciiFromBytes(token));
  }

  private parseList(depth: number): BValue[] {
    this.offset += 1;
    const values: BValue[] = [];

    while (this.peek() !== 0x65) {
      if (this.offset >= this.bytes.length) {
        this.fail('unterminated-list', '种子文件包含未结束的列表。');
      }
      values.push(this.parseValue(depth + 1));
    }

    this.offset += 1;
    return values;
  }

  private parseDictionary(depth: number, captureRootInfo: boolean): BDictionary {
    this.offset += 1;
    const entries: BDictionaryEntry[] = [];
    const seenKeys = new Set<string>();
    let previousKey: Uint8Array | undefined;

    while (this.peek() !== 0x65) {
      if (this.offset >= this.bytes.length) {
        this.fail('unterminated-dictionary', '种子文件包含未结束的字典。');
      }
      const marker = this.peek();
      if (marker < 0x30 || marker > 0x39) {
        this.fail('non-string-key', 'Bencode 字典的键必须是字节字符串。');
      }

      this.consumeNode();
      const key = this.parseByteString(this.limits.maxDictionaryKeyLength);
      const identity = binaryIdentity(key);
      if (seenKeys.has(identity)) {
        this.fail('duplicate-key', '种子文件包含重复的字典键。');
      }
      if (previousKey && compareBytes(previousKey, key) > 0) this.isCanonical = false;
      seenKeys.add(identity);
      previousKey = key;

      const valueStart = this.offset;
      const value = this.parseValue(depth + 1);
      const valueEnd = this.offset;
      entries.push({ key, value });

      if (captureRootInfo && bytesEqualAscii(key, 'info')) {
        this.infoRange = { start: valueStart, end: valueEnd };
      }
    }

    this.offset += 1;
    return new BDictionary(entries);
  }

  private parseByteString(maxLength = this.limits.maxByteStringLength): Uint8Array {
    const lengthStart = this.offset;
    let length = 0;

    while (this.offset < this.bytes.length) {
      const byte = this.bytes[this.offset];
      if (byte === 0x3a) break;
      if (byte === undefined || byte < 0x30 || byte > 0x39) {
        this.fail('invalid-string-length', '种子文件包含无效的字节字符串长度。');
      }
      const digit = byte - 0x30;
      if (length > Math.floor((Number.MAX_SAFE_INTEGER - digit) / 10)) {
        this.fail('string-length-overflow', '种子文件的字节字符串长度过大。');
      }
      length = length * 10 + digit;
      this.offset += 1;
    }

    if (this.offset === lengthStart || this.offset >= this.bytes.length) {
      this.fail('invalid-string-length', '种子文件包含无效的字节字符串长度。');
    }
    if (this.bytes[lengthStart] === 0x30 && this.offset - lengthStart > 1) {
      this.fail('string-length-leading-zero', '字节字符串长度不能包含前导零。');
    }
    if (length > maxLength) {
      this.fail('string-limit', '种子文件包含异常长的字段。');
    }

    this.offset += 1;
    const end = this.offset + length;
    if (end > this.bytes.length) {
      this.fail('truncated-string', '种子文件中的字节字符串不完整。');
    }

    const value = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  private consumeNode(): void {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) {
      this.fail('node-limit', '种子文件包含过多字段。');
    }
  }

  private peek(): number {
    return this.bytes[this.offset] ?? -1;
  }

  private fail(code: string, message: string): never {
    throw new TorrentFormatError(code, message);
  }
}

function bytesEqualAscii(bytes: Uint8Array, value: string): boolean {
  if (bytes.length !== value.length) return false;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function binaryIdentity(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function asciiFromBytes(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}
