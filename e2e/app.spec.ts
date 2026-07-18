import { expect, test } from '@playwright/test';

const V1_FIXTURE =
  'ZDg6YW5ub3VuY2UzMzpodHRwczovL2ZhbGxiYWNrLmV4YW1wbGUvYW5ub3VuY2UxMzphbm5vdW5jZS1saXN0bGw0MzpodHRwczovL3RyYWNrZXIuZXhhbXBsZS9hbm5vdW5jZT9wYXNzPWEmeD0xZWwzNTp1ZHA6Ly90cmFja2VyLmV4YW1wbGU6Njk2OS9hbm5vdW5jZWVlNDppbmZvZDY6bGVuZ3RoaTVlNDpuYW1lMTU6aGVsbG8gd29ybGQudHh0MTI6cGllY2UgbGVuZ3RoaTE2Mzg0ZTY6cGllY2VzMjA6AAECAwQFBgcICQoLDA0ODxAREhNlODp1cmwtbGlzdGwyNzpodHRwczovL3NlZWQuZXhhbXBsZS9maWxlcy9lZQ==';
const EXPECTED_MAGNET =
  'magnet:?xt=urn:btih:06f2906355358abd3b5a5cc60fefe5863fd1ca95&dn=hello%20world.txt&tr=https%3A%2F%2Ftracker.example%2Fannounce%3Fpass%3Da%26x%3D1&tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce&ws=https%3A%2F%2Fseed.example%2Ffiles%2F';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('converts a torrent without sending it away', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /把种子文件/ })).toBeVisible();
  const conversionRequests: string[] = [];
  page.on('request', (request) => conversionRequests.push(request.url()));
  await page.locator('#torrent-file').setInputFiles({
    name: 'hello.torrent',
    mimeType: 'application/x-bittorrent',
    buffer: Buffer.from(V1_FIXTURE, 'base64'),
  });

  await expect(page.getByText('转换完成')).toBeVisible();
  await expect(page.locator('#torrent-kind')).toHaveText('BitTorrent v1');
  await expect(page.locator('#magnet-output')).toHaveValue(EXPECTED_MAGNET);
  await expect(page.locator('#tracker-list input:checked')).toHaveCount(2);

  await page.getByRole('button', { name: '全部取消' }).click();
  await expect(page.locator('#magnet-output')).not.toHaveValue(EXPECTED_MAGNET);
  await page.getByRole('button', { name: '全选' }).click();
  await expect(page.locator('#magnet-output')).toHaveValue(EXPECTED_MAGNET);

  await page.getByRole('button', { name: '复制链接' }).click();
  await expect(page.getByText('磁力链接已复制到剪贴板。')).toBeVisible();

  expect(conversionRequests).toEqual([]);
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test('shows a recoverable error for a non-torrent file', async ({ page }) => {
  await page.goto('/');
  await page.locator('#torrent-file').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a torrent'),
  });

  await expect(page.getByRole('alert')).toContainText('请选择 .torrent 文件');
  await expect(page.locator('#torrent-file')).toBeFocused();
});
