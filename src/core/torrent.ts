import { sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  BDictionary,
  decodeUtf8,
  parseTorrentDocument,
  TorrentFormatError,
} from './bencode';

export const MAX_TORRENT_SIZE = 20 * 1024 * 1024;

export type TorrentKind = 'v1' | 'v2' | 'hybrid';

export interface TorrentMetadata {
  readonly sourceFileName: string;
  readonly name: string;
  readonly kind: TorrentKind;
  readonly totalSize: bigint;
  readonly fileCount: number;
  readonly trackers: readonly string[];
  readonly webSeeds: readonly string[];
  readonly v1InfoHash?: string;
  readonly v2InfoHash?: string;
  readonly isPrivate: boolean;
  readonly infoByteLength: number;
}

interface FileSummary {
  readonly totalSize: bigint;
  readonly fileCount: number;
  readonly files: readonly TorrentFile[];
  readonly layoutFiles: readonly TorrentFile[];
  readonly pieceLength: bigint;
}

interface TorrentFile {
  readonly length: bigint;
  readonly path: readonly Uint8Array[];
  readonly isPadding: boolean;
  readonly isSymlink: boolean;
  readonly piecesRoot?: Uint8Array;
}

const MAX_URLS = 256;
const MAX_URL_LENGTH = 4096;

export function parseTorrent(bytes: Uint8Array, sourceFileName: string): TorrentMetadata {
  if (bytes.byteLength > MAX_TORRENT_SIZE) {
    throw new TorrentFormatError('file-too-large', '文件超过 20 MB，请选择更小的种子文件。');
  }

  const document = parseTorrentDocument(bytes, {
    maxByteStringLength: MAX_TORRENT_SIZE,
  });
  const { root, info, infoBytes } = document;
  const name = readTorrentName(info, sourceFileName);
  const metaVersion = info.getAscii('meta version');
  const isV2 = metaVersion !== undefined;

  if (isV2 && (typeof metaVersion !== 'bigint' || metaVersion !== 2n)) {
    throw new TorrentFormatError('unsupported-meta-version', '暂不支持这个种子使用的元信息版本。');
  }
  if (isV2 && !document.isCanonical) {
    throw new TorrentFormatError('unsorted-key', 'v2 种子的字典键没有按原始字节排序。');
  }

  const v1LayoutPresent = info.hasAscii('length') || info.hasAscii('files');
  const v1PiecesPresent = info.hasAscii('pieces');
  let kind: TorrentKind;
  let summary: FileSummary;

  if (!isV2) {
    summary = validateAndSummarizeV1(info);
    kind = 'v1';
  } else {
    const v2Summary = validateAndSummarizeV2(root, info);
    if (v1LayoutPresent || v1PiecesPresent) {
      const v1Summary = validateAndSummarizeV1(info);
      validateHybridFiles(v1Summary, v2Summary);
      summary = v1Summary;
      kind = 'hybrid';
    } else {
      summary = v2Summary;
      kind = 'v2';
    }
  }

  const v1InfoHash = kind === 'v1' || kind === 'hybrid' ? bytesToHex(sha1(infoBytes)) : undefined;
  const v2InfoHash = kind === 'v2' || kind === 'hybrid' ? bytesToHex(sha256(infoBytes)) : undefined;

  return {
    sourceFileName,
    name,
    kind,
    totalSize: summary.totalSize,
    fileCount: summary.fileCount,
    trackers: readTrackers(root),
    webSeeds: readWebSeeds(root),
    v1InfoHash,
    v2InfoHash,
    isPrivate: info.getAscii('private') === 1n,
    infoByteLength: infoBytes.byteLength,
  };
}

export function buildMagnet(
  metadata: TorrentMetadata,
  trackers: readonly string[] = metadata.trackers,
  webSeeds: readonly string[] = metadata.webSeeds,
): string {
  const parameters: string[] = [];
  if (metadata.v1InfoHash) {
    parameters.push(`xt=urn:btih:${metadata.v1InfoHash}`);
  }
  if (metadata.v2InfoHash) {
    parameters.push(`xt=urn:btmh:1220${metadata.v2InfoHash}`);
  }
  parameters.push(`dn=${encodeURIComponent(metadata.name)}`);

  for (const tracker of stableUnique(trackers).slice(0, MAX_URLS)) {
    if (isSupportedTracker(tracker)) parameters.push(`tr=${encodeURIComponent(tracker)}`);
  }
  for (const webSeed of stableUnique(webSeeds).slice(0, MAX_URLS)) {
    if (isSupportedWebSeed(webSeed)) parameters.push(`ws=${encodeURIComponent(webSeed)}`);
  }

  return `magnet:?${parameters.join('&')}`;
}

function validateAndSummarizeV1(info: BDictionary): FileSummary {
  const pieces = info.getAscii('pieces');
  if (!(pieces instanceof Uint8Array) || pieces.length % 20 !== 0) {
    throw new TorrentFormatError('invalid-v1-pieces', '种子的 v1 pieces 字段无效。');
  }
  const pieceLength = validatePieceLength(info.getAscii('piece length'), false);

  const singleLength = info.getAscii('length');
  const files = info.getAscii('files');
  if ((singleLength === undefined) === (files === undefined)) {
    throw new TorrentFormatError('invalid-v1-layout', '种子的 v1 文件结构无效。');
  }

  if (singleLength !== undefined) {
    const length = requireNonNegativeLength(singleLength);
    validateV1PieceCount(pieces, pieceLength, length);
    return summarizeFiles(
      [
        {
          length,
          path: [requireTorrentNameBytes(info)],
          isPadding: false,
          isSymlink: false,
        },
      ],
      pieceLength,
    );
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new TorrentFormatError('invalid-v1-files', '种子的多文件列表无效。');
  }

  let pieceSpanSize = 0n;
  const torrentFiles: TorrentFile[] = [];
  for (const file of files) {
    if (!(file instanceof BDictionary)) {
      throw new TorrentFormatError('invalid-v1-file', '种子的文件条目无效。');
    }
    const attributes = readAttributes(file);
    const isPadding = attributes.includes('p');
    const isSymlink = attributes.includes('l') || file.hasAscii('symlink path');
    const rawLength = file.getAscii('length');
    const length = rawLength === undefined && isSymlink ? 0n : requireNonNegativeLength(rawLength);
    pieceSpanSize += length;
    torrentFiles.push({
      length,
      path: readV1Path(file, isPadding),
      isPadding,
      isSymlink,
    });
  }
  validateV1PieceCount(pieces, pieceLength, pieceSpanSize);
  const summary = summarizeFiles(torrentFiles, pieceLength);
  if (summary.fileCount === 0) {
    throw new TorrentFormatError('empty-v1-files', '种子的 v1 文件列表不包含实际文件。');
  }
  return summary;
}

function validateAndSummarizeV2(root: BDictionary, info: BDictionary): FileSummary {
  const pieceLength = validatePieceLength(info.getAscii('piece length'), true);
  const pieceLayers = root.getAscii('piece layers');
  if (!(pieceLayers instanceof BDictionary)) {
    throw new TorrentFormatError('missing-piece-layers', '种子的 v2 piece layers 字典无效。');
  }
  const fileTree = info.getAscii('file tree');
  if (!(fileTree instanceof BDictionary)) {
    throw new TorrentFormatError('missing-file-tree', '种子的 v2 file tree 字典无效。');
  }

  const summary = summarizeFiles(collectV2Files(fileTree, 0, []), pieceLength);
  if (summary.fileCount === 0) {
    throw new TorrentFormatError('empty-file-tree', '种子的 v2 文件树为空。');
  }
  validatePieceLayers(pieceLayers, summary.files, pieceLength);
  return summary;
}

function collectV2Files(
  tree: BDictionary,
  depth: number,
  path: readonly Uint8Array[],
): TorrentFile[] {
  if (depth > 64) {
    throw new TorrentFormatError('file-tree-depth', '种子的 v2 文件树层级过深。');
  }

  const leafEntry = tree.entries.find((entry) => entry.key.length === 0);
  if (leafEntry) {
    if (depth === 0 || tree.entries.length !== 1 || !(leafEntry.value instanceof BDictionary)) {
      throw new TorrentFormatError('invalid-file-tree-leaf', '种子的 v2 文件树叶节点无效。');
    }
    const length = leafEntry.value.getAscii('length');
    const attributes = readAttributes(leafEntry.value);
    if (length === undefined && leafEntry.value.hasAscii('symlink path')) {
      return [
        {
          length: 0n,
          path,
          isPadding: attributes.includes('p'),
          isSymlink: true,
        },
      ];
    }
    const fileLength = requireNonNegativeLength(length);
    const piecesRoot = leafEntry.value.getAscii('pieces root');
    if (fileLength > 0n && (!(piecesRoot instanceof Uint8Array) || piecesRoot.length !== 32)) {
      throw new TorrentFormatError('invalid-pieces-root', '非空 v2 文件缺少有效的 pieces root。');
    }
    return [
      {
        length: fileLength,
        path,
        isPadding: attributes.includes('p'),
        isSymlink: attributes.includes('l'),
        piecesRoot: piecesRoot instanceof Uint8Array ? piecesRoot : undefined,
      },
    ];
  }

  const files: TorrentFile[] = [];
  for (const entry of tree.entries) {
    if (!(entry.value instanceof BDictionary)) {
      throw new TorrentFormatError('invalid-file-tree-node', '种子的 v2 文件树节点无效。');
    }

    files.push(...collectV2Files(entry.value, depth + 1, [...path, entry.key]));
  }
  return files;
}

function summarizeFiles(files: readonly TorrentFile[], pieceLength: bigint): FileSummary {
  const contentFiles = files.filter((file) => !file.isPadding);
  return {
    totalSize: contentFiles.reduce((total, file) => total + file.length, 0n),
    fileCount: contentFiles.length,
    files: contentFiles,
    layoutFiles: files,
    pieceLength,
  };
}

function validateHybridFiles(v1Summary: FileSummary, v2Summary: FileSummary): void {
  const v1Files = v1Summary.files;
  const v2Files = v2Summary.files;
  if (v1Files.length !== v2Files.length) {
    throw new TorrentFormatError('hybrid-layout-mismatch', '混合种子的 v1 与 v2 文件结构不一致。');
  }

  for (let index = 0; index < v1Files.length; index += 1) {
    const v1File = v1Files[index];
    const v2File = v2Files[index];
    if (
      !v1File ||
      !v2File ||
      v1File.length !== v2File.length ||
      v1File.isSymlink !== v2File.isSymlink ||
      !pathsEqual(v1File.path, v2File.path)
    ) {
      throw new TorrentFormatError('hybrid-layout-mismatch', '混合种子的 v1 与 v2 文件结构不一致。');
    }
  }

  validateHybridAlignment(v1Summary, v2Summary);
}

function validateHybridAlignment(v1Summary: FileSummary, v2Summary: FileSummary): void {
  if (v1Summary.pieceLength !== v2Summary.pieceLength) {
    throw new TorrentFormatError('hybrid-layout-mismatch', '混合种子的 v1 与 v2 文件结构不一致。');
  }

  let actualOffset = 0n;
  const actualContentStarts: bigint[] = [];
  for (const file of v1Summary.layoutFiles) {
    if (!file.isPadding) actualContentStarts.push(actualOffset);
    actualOffset += file.length;
  }

  let expectedOffset = 0n;
  for (let index = 0; index < v2Summary.files.length; index += 1) {
    const file = v2Summary.files[index];
    if (!file || file.length === 0n || file.isSymlink) continue;
    expectedOffset = alignToPiece(expectedOffset, v2Summary.pieceLength);
    if (actualContentStarts[index] !== expectedOffset) {
      throw new TorrentFormatError('hybrid-layout-mismatch', '混合种子的 v1 padding 对齐无效。');
    }
    expectedOffset += file.length;
  }

  const alignedEnd = alignToPiece(expectedOffset, v2Summary.pieceLength);
  if (actualOffset !== expectedOffset && actualOffset !== alignedEnd) {
    throw new TorrentFormatError('hybrid-layout-mismatch', '混合种子的 v1 padding 对齐无效。');
  }
}

function alignToPiece(offset: bigint, pieceLength: bigint): bigint {
  const remainder = offset % pieceLength;
  return remainder === 0n ? offset : offset + pieceLength - remainder;
}

function validatePieceLayers(
  pieceLayers: BDictionary,
  files: readonly TorrentFile[],
  pieceLength: bigint,
): void {
  const layeredFiles = files.filter(
    (file) => !file.isSymlink && file.length > pieceLength && file.piecesRoot,
  );
  const expectedRoots: Uint8Array[] = [];

  for (const file of layeredFiles) {
    const piecesRoot = file.piecesRoot;
    if (!piecesRoot) continue;
    if (!expectedRoots.some((root) => bytesEqual(root, piecesRoot))) expectedRoots.push(piecesRoot);

    const layerEntry = pieceLayers.entries.find((entry) => bytesEqual(entry.key, piecesRoot));
    if (!(layerEntry?.value instanceof Uint8Array) || layerEntry.value.length % 32 !== 0) {
      throw new TorrentFormatError('invalid-piece-layer', '种子的 v2 piece layer 缺失或格式无效。');
    }

    const expectedHashCount = (file.length + pieceLength - 1n) / pieceLength;
    if (BigInt(layerEntry.value.length / 32) !== expectedHashCount) {
      throw new TorrentFormatError('invalid-piece-layer', '种子的 v2 piece layer 哈希数量无效。');
    }
    if (!pieceLayerMatchesRoot(layerEntry.value, piecesRoot, pieceLength)) {
      throw new TorrentFormatError('invalid-piece-layer-root', '种子的 v2 piece layer 与 pieces root 不匹配。');
    }
  }

  if (
    pieceLayers.entries.length !== expectedRoots.length ||
    pieceLayers.entries.some(
      (entry) => entry.key.length !== 32 || !expectedRoots.some((root) => bytesEqual(root, entry.key)),
    )
  ) {
    throw new TorrentFormatError('unexpected-piece-layer', '种子的 v2 piece layers 包含多余字段。');
  }
}

function pieceLayerMatchesRoot(
  layer: Uint8Array,
  piecesRoot: Uint8Array,
  pieceLength: bigint,
): boolean {
  let hashes: Uint8Array[] = [];
  for (let offset = 0; offset < layer.length; offset += 32) {
    hashes.push(layer.slice(offset, offset + 32));
  }

  let zeroHash: Uint8Array = new Uint8Array(32);
  for (let size = 16_384n; size < pieceLength; size *= 2n) {
    zeroHash = hashPair(zeroHash, zeroHash);
  }

  let paddedCount = 1;
  while (paddedCount < hashes.length) paddedCount *= 2;
  while (hashes.length < paddedCount) hashes.push(zeroHash);

  while (hashes.length > 1) {
    const parents: Uint8Array[] = [];
    for (let index = 0; index < hashes.length; index += 2) {
      const left = hashes[index];
      const right = hashes[index + 1];
      if (!left || !right) return false;
      parents.push(hashPair(left, right));
    }
    hashes = parents;
  }

  return Boolean(hashes[0] && bytesEqual(hashes[0], piecesRoot));
}

function hashPair(left: Uint8Array, right: Uint8Array): Uint8Array {
  const pair = new Uint8Array(64);
  pair.set(left, 0);
  pair.set(right, 32);
  return sha256(pair);
}

function validatePieceLength(value: unknown, requireV2Rules: boolean): bigint {
  if (typeof value !== 'bigint' || value <= 0n) {
    throw new TorrentFormatError('invalid-piece-length', '种子的 piece length 字段无效。');
  }
  if (requireV2Rules && (value < 16_384n || (value & (value - 1n)) !== 0n)) {
    throw new TorrentFormatError('invalid-v2-piece-length', '种子的 v2 piece length 必须是至少 16 KiB 的 2 次幂。');
  }
  return value;
}

function validateV1PieceCount(pieces: Uint8Array, pieceLength: bigint, totalSize: bigint): void {
  const expected = totalSize === 0n ? 0n : (totalSize + pieceLength - 1n) / pieceLength;
  if (BigInt(pieces.length / 20) !== expected) {
    throw new TorrentFormatError('invalid-v1-piece-count', '种子的 v1 piece 数量与文件大小不匹配。');
  }
}

function requireNonNegativeLength(value: unknown): bigint {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new TorrentFormatError('invalid-file-length', '种子包含无效的文件大小。');
  }
  return value;
}

function requireTorrentNameBytes(info: BDictionary): Uint8Array {
  const preferred = info.getAscii('name.utf-8');
  const fallback = info.getAscii('name');
  const name = preferred instanceof Uint8Array ? preferred : fallback;
  if (!(name instanceof Uint8Array) || name.length === 0) {
    throw new TorrentFormatError('missing-name', '种子的名称字段无效。');
  }
  return name;
}

function readV1Path(file: BDictionary, allowMissing: boolean): Uint8Array[] {
  const preferred = file.getAscii('path.utf-8');
  const fallback = file.getAscii('path');
  const path = Array.isArray(preferred) ? preferred : fallback;
  if (path === undefined && allowMissing) return [];
  if (!Array.isArray(path) || path.length === 0) {
    throw new TorrentFormatError('invalid-v1-path', '种子的 v1 文件路径无效。');
  }

  return path.map((component) => {
    if (!(component instanceof Uint8Array) || component.length === 0) {
      throw new TorrentFormatError('invalid-v1-path', '种子的 v1 文件路径无效。');
    }
    return component;
  });
}

function readAttributes(dictionary: BDictionary): string {
  const value = dictionary.getAscii('attr');
  return value instanceof Uint8Array ? decodeUtf8(value) : '';
}

function pathsEqual(left: readonly Uint8Array[], right: readonly Uint8Array[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((component, index) => bytesEqual(component, right[index]));
}

function bytesEqual(left: Uint8Array, right: Uint8Array | undefined): boolean {
  if (!right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function readTorrentName(info: BDictionary, sourceFileName: string): string {
  const rawName = (() => {
    try {
      return requireTorrentNameBytes(info);
    } catch {
      return undefined;
    }
  })();
  if (rawName instanceof Uint8Array) {
    const decoded = cleanText(decodeUtf8(rawName));
    if (decoded) return decoded;
  }

  const sourceFallback = sourceFileName.replace(/\.torrent$/i, '').trim();
  if (sourceFallback) return sourceFallback;
  throw new TorrentFormatError('missing-name', '种子的名称字段无效。');
}

function readTrackers(root: BDictionary): string[] {
  const announceList = root.getAscii('announce-list');
  if (Array.isArray(announceList)) {
    const tiered: string[] = [];
    let validStructure = true;
    for (const tier of announceList) {
      if (!Array.isArray(tier)) {
        validStructure = false;
        break;
      }
      for (const value of tier) {
        const url = readUrl(value, isSupportedTracker);
        if (url) tiered.push(url);
      }
    }
    if (validStructure && tiered.length > 0) return stableUnique(tiered).slice(0, MAX_URLS);
  }

  const announce = readUrl(root.getAscii('announce'), isSupportedTracker);
  return announce ? [announce] : [];
}

function readWebSeeds(root: BDictionary): string[] {
  const value = root.getAscii('url-list');
  const candidates = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const urls: string[] = [];
  for (const candidate of candidates) {
    const url = readUrl(candidate, isSupportedWebSeed);
    if (url) urls.push(url);
  }
  return stableUnique(urls).slice(0, MAX_URLS);
}

function readUrl(value: unknown, validator: (url: string) => boolean): string | undefined {
  if (!(value instanceof Uint8Array) || value.length === 0 || value.length > MAX_URL_LENGTH) {
    return undefined;
  }
  const decoded = decodeUtf8(value).trim();
  return validator(decoded) ? decoded : undefined;
}

function isSupportedTracker(value: string): boolean {
  return /^(?:https?|udp|wss?):\/\/[^\s]+$/i.test(value);
}

function isSupportedWebSeed(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value);
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '\ufffd').trim();
}
