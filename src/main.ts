import './style.css';
import { formatBytes, formatFileCount, kindLabel } from './core/format';
import {
  buildMagnet,
  MAX_TORRENT_SIZE,
  parseTorrent,
  type TorrentMetadata,
} from './core/torrent';
import { TorrentFormatError } from './core/bencode';

const converterCard = element<HTMLElement>('converter-card');
const fileInput = element<HTMLInputElement>('torrent-file');
const dropZone = element<HTMLLabelElement>('drop-zone');
const dropTitle = element<HTMLElement>('drop-title');
const uploadView = element<HTMLElement>('upload-view');
const processingView = element<HTMLElement>('processing-view');
const processingFileName = element<HTMLElement>('processing-file-name');
const resultView = element<HTMLElement>('result-view');
const errorBanner = element<HTMLElement>('error-banner');
const errorMessage = element<HTMLElement>('error-message');
const sourceFileName = element<HTMLElement>('source-file-name');
const torrentName = element<HTMLElement>('torrent-name');
const torrentKind = element<HTMLElement>('torrent-kind');
const torrentSize = element<HTMLElement>('torrent-size');
const torrentFileCount = element<HTMLElement>('torrent-file-count');
const privacyBadge = element<HTMLElement>('privacy-badge');
const v1HashRow = element<HTMLElement>('v1-hash-row');
const v2HashRow = element<HTMLElement>('v2-hash-row');
const v1InfoHash = element<HTMLElement>('v1-info-hash');
const v2InfoHash = element<HTMLElement>('v2-info-hash');
const trackerActions = element<HTMLElement>('tracker-actions');
const trackerList = element<HTMLElement>('tracker-list');
const trackerEmpty = element<HTMLElement>('tracker-empty');
const trackerSummary = element<HTMLElement>('tracker-summary');
const webseedSummary = element<HTMLElement>('webseed-summary');
const selectAllTrackers = element<HTMLButtonElement>('select-all-trackers');
const clearAllTrackers = element<HTMLButtonElement>('clear-all-trackers');
const magnetOutput = element<HTMLTextAreaElement>('magnet-output');
const copyMagnetButton = element<HTMLButtonElement>('copy-magnet');
const copyButtonLabel = element<HTMLElement>('copy-button-label');
const copyStatus = element<HTMLElement>('copy-status');
const chooseAnotherButton = element<HTMLButtonElement>('choose-another');

let currentTorrent: TorrentMetadata | undefined;
let selectedTrackers = new Set<string>();
let dragDepth = 0;
let copyFeedbackTimer: number | undefined;

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void convertFile(file);
});

dropZone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  setDragging(true);
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});

dropZone.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragging(false);
});

dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  setDragging(false);
  const file = event.dataTransfer?.files[0];
  if (file) void convertFile(file);
});

selectAllTrackers.addEventListener('click', () => {
  if (!currentTorrent) return;
  selectedTrackers = new Set(currentTorrent.trackers);
  syncTrackerCheckboxes();
  updateMagnet();
});

clearAllTrackers.addEventListener('click', () => {
  selectedTrackers.clear();
  syncTrackerCheckboxes();
  updateMagnet();
});

copyMagnetButton.addEventListener('click', () => void copyMagnet());
magnetOutput.addEventListener('focus', () => magnetOutput.select());

chooseAnotherButton.addEventListener('click', () => {
  fileInput.value = '';
  fileInput.click();
});

async function convertFile(file: File): Promise<void> {
  clearCopyFeedback();
  errorBanner.hidden = true;

  try {
    validateFile(file);
    showProcessing(file.name);
    await nextPaint();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadata = parseTorrent(bytes, file.name);
    renderResult(metadata);
  } catch (error) {
    showError(error, file.name);
  } finally {
    fileInput.value = '';
  }
}

function validateFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.torrent')) {
    throw new TorrentFormatError('invalid-extension', '请选择 .torrent 文件。');
  }
  if (file.size === 0) {
    throw new TorrentFormatError('empty-file', '种子文件为空。');
  }
  if (file.size > MAX_TORRENT_SIZE) {
    throw new TorrentFormatError('file-too-large', '文件超过 20 MB，请选择更小的种子文件。');
  }
}

function showProcessing(fileName: string): void {
  uploadView.hidden = true;
  resultView.hidden = true;
  processingView.hidden = false;
  processingFileName.textContent = fileName;
  converterCard.setAttribute('aria-busy', 'true');
}

function renderResult(metadata: TorrentMetadata): void {
  currentTorrent = metadata;
  selectedTrackers = new Set(metadata.trackers);

  sourceFileName.textContent = metadata.sourceFileName;
  sourceFileName.title = metadata.sourceFileName;
  torrentName.textContent = metadata.name;
  torrentName.title = metadata.name;
  torrentKind.textContent = kindLabel(metadata.kind);
  torrentSize.textContent = formatBytes(metadata.totalSize);
  torrentFileCount.textContent = formatFileCount(metadata.fileCount);
  privacyBadge.textContent = metadata.isPrivate ? '私有种子 · 本地完成' : '本地完成';

  v1HashRow.hidden = !metadata.v1InfoHash;
  v2HashRow.hidden = !metadata.v2InfoHash;
  v1InfoHash.textContent = metadata.v1InfoHash ?? '';
  v2InfoHash.textContent = metadata.v2InfoHash ?? '';

  renderTrackers(metadata);
  updateMagnet();

  processingView.hidden = true;
  uploadView.hidden = true;
  resultView.hidden = false;
  converterCard.setAttribute('aria-busy', 'false');
  copyMagnetButton.focus();
}

function renderTrackers(metadata: TorrentMetadata): void {
  trackerList.replaceChildren();
  const hasTrackers = metadata.trackers.length > 0;
  trackerActions.hidden = !hasTrackers;
  trackerList.hidden = !hasTrackers;
  trackerEmpty.hidden = hasTrackers;

  metadata.trackers.forEach((tracker, index) => {
    const label = document.createElement('label');
    label.className = 'tracker-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.tracker = tracker;
    checkbox.id = `tracker-${index}`;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedTrackers.add(tracker);
      else selectedTrackers.delete(tracker);
      updateMagnet();
    });

    const text = document.createElement('span');
    text.textContent = tracker;
    text.title = tracker;
    label.append(checkbox, text);
    trackerList.append(label);
  });

  if (metadata.webSeeds.length > 0) {
    webseedSummary.hidden = false;
    webseedSummary.textContent = `另有 ${formatFileCount(metadata.webSeeds.length)} 个 Web Seed 将自动写入链接。`;
  } else {
    webseedSummary.hidden = true;
    webseedSummary.textContent = '';
  }
}

function updateMagnet(): void {
  if (!currentTorrent) return;
  const trackers = currentTorrent.trackers.filter((tracker) => selectedTrackers.has(tracker));
  magnetOutput.value = buildMagnet(currentTorrent, trackers);
  trackerSummary.textContent = currentTorrent.trackers.length
    ? `已选择 ${trackers.length} / ${currentTorrent.trackers.length} 个 Tracker`
    : '选择要写入磁力链接的 Tracker';
  clearCopyFeedback();
}

function syncTrackerCheckboxes(): void {
  for (const checkbox of trackerList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    const tracker = checkbox.dataset.tracker;
    checkbox.checked = tracker !== undefined && selectedTrackers.has(tracker);
  }
}

async function copyMagnet(): Promise<void> {
  const value = magnetOutput.value;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      magnetOutput.focus();
      magnetOutput.select();
      if (!document.execCommand('copy')) throw new Error('copy command failed');
    }
    copyButtonLabel.textContent = '已复制';
    copyStatus.textContent = '磁力链接已复制到剪贴板。';
    copyMagnetButton.classList.add('is-copied');
    copyFeedbackTimer = window.setTimeout(clearCopyFeedback, 2000);
  } catch {
    magnetOutput.focus();
    magnetOutput.select();
    copyStatus.textContent = '自动复制失败，链接已选中，请手动复制。';
  }
}

function clearCopyFeedback(): void {
  if (copyFeedbackTimer !== undefined) {
    window.clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = undefined;
  }
  copyButtonLabel.textContent = '复制链接';
  copyStatus.textContent = '';
  copyMagnetButton.classList.remove('is-copied');
}

function showError(error: unknown, fileName: string): void {
  currentTorrent = undefined;
  selectedTrackers.clear();
  processingView.hidden = true;
  resultView.hidden = true;
  uploadView.hidden = false;
  errorBanner.hidden = false;
  converterCard.setAttribute('aria-busy', 'false');

  const message =
    error instanceof TorrentFormatError
      ? error.message
      : '它可能不是有效的 .torrent 文件，或文件内容已损坏。';
  errorMessage.textContent = `${fileName}：${message}`;
  fileInput.focus();
}

function setDragging(active: boolean): void {
  dropZone.classList.toggle('is-dragging', active);
  dropTitle.textContent = active ? '松开即可开始转换' : '拖入 .torrent 文件';
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}
