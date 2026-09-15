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
  await page.evaluate(() => document.fonts.ready);
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
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#torrent-file').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a torrent'),
  });

  await expect(page.getByRole('alert')).toContainText('请选择 .torrent 文件');
  await expect(page.locator('#torrent-file')).toBeFocused();
});

for (const width of [320, 375, 414, 768, 1440]) {
  test(`workbench stays usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const checkLayout = async () => {
      const failures = await page.evaluate(() => {
        const errors: string[] = [];
        if (document.documentElement.scrollWidth > innerWidth) errors.push('document overflow');
        for (const el of document.querySelectorAll<HTMLElement>('button, .source-link, footer a, .upload-button')) {
          if (!el.getClientRects().length) continue;
          const box = el.getBoundingClientRect();
          if (box.width > innerWidth || box.right > innerWidth || box.left < 0) errors.push(`offscreen: ${el.id || el.className}`);
          if (box.height < 44) errors.push(`small target: ${el.id || el.className}`);
          if (el.scrollWidth > el.clientWidth + 1) errors.push(`clipped label: ${el.id || el.className}`);
        }
        return errors;
      });
      expect(failures).toEqual([]);
    };
    await checkLayout();
    await page.screenshot({ path: testInfo.outputPath(`idle-${width}.png`), fullPage: true });
    await page.locator('#torrent-file').setInputFiles({
      name: 'very-long-file-name-for-layout-validation-0123456789.torrent',
      mimeType: 'application/x-bittorrent', buffer: Buffer.from(V1_FIXTURE, 'base64'),
    });
    await expect(page.locator('#magnet-output')).toHaveValue(EXPECTED_MAGNET);
    await checkLayout();
    await page.screenshot({ path: testInfo.outputPath(`result-${width}.png`), fullPage: true });
  });
}

test('invalid file can recover through a keyboard-accessible picker', async ({ page }) => {
  await page.goto('/');
  await page.locator('#torrent-file').setInputFiles({ name: 'empty.torrent', mimeType: 'application/x-bittorrent', buffer: Buffer.alloc(0) });
  await expect(page.getByRole('alert')).toContainText('种子文件为空');
  await expect(page.locator('#torrent-file')).toBeFocused();
  await expect(page.locator('#drop-zone')).toHaveCSS('outline-style', 'solid');
  await page.locator('#torrent-file').setInputFiles({ name: 'hello.torrent', mimeType: 'application/x-bittorrent', buffer: Buffer.from(V1_FIXTURE, 'base64') });
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.locator('#magnet-output')).toHaveValue(EXPECTED_MAGNET);
  await page.locator('#tracker-list input').first().uncheck();
  await expect(page.locator('#tracker-summary')).toHaveText('已选择 1 / 2 个 Tracker');
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '转换另一个文件' }).click();
  await (await picker).setFiles({ name: 'another.torrent', mimeType: 'application/x-bittorrent', buffer: Buffer.from(V1_FIXTURE, 'base64') });
  await expect(page.locator('#source-file-name')).toHaveText('another.torrent');
  await expect(page.locator('#tracker-list input:checked')).toHaveCount(2);
});

test('supports drag and drop and clipboard failure feedback', async ({ page }) => {
  await page.goto('/');
  const transfer = await page.evaluateHandle((encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'dropped.torrent', { type: 'application/x-bittorrent' }));
    return data;
  }, V1_FIXTURE);
  await page.locator('#drop-zone').dispatchEvent('dragenter', { dataTransfer: transfer });
  await expect(page.locator('#drop-title')).toHaveText('松开即可开始转换');
  await page.locator('#drop-zone').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.locator('#magnet-output')).toHaveValue(EXPECTED_MAGNET);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));
  await page.getByRole('button', { name: '复制链接' }).click();
  await expect(page.locator('#copy-status')).toHaveText('自动复制失败，链接已选中，请手动复制。');
  await expect(page.locator('#magnet-output')).toBeFocused();
});

test('text and focus colors remain readable on the dark workbench', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const auditContrast = () => page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    function rgba(color: string) {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    }
    function luminance(color: string) {
      const rgb = rgba(color).slice(0, 3).map((x) => {
        const c = x / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      });
      return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
    }
    function contrast(a: string, b: string) {
      const [lo, hi] = [luminance(a), luminance(b)].sort((x,y) => x-y);
      return (hi! + .05) / (lo! + .05);
    }
    const failures: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (!el.getClientRects().length || el.closest('[aria-hidden="true"], .visually-hidden, svg') || ![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
      const style = getComputedStyle(el);
      let parent: HTMLElement | null = el;
      while (parent && rgba(getComputedStyle(parent).backgroundColor)[3] === 0) parent = parent.parentElement;
      const bg = getComputedStyle(parent ?? document.documentElement).backgroundColor;
      const minimum = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      const ratio = contrast(style.color, bg);
      if (ratio < minimum) failures.push(`${el.id || el.className}: ${ratio.toFixed(2)}`);
    }
    const root = getComputedStyle(document.documentElement);
    const focus = root.getPropertyValue('--color-focus');
    for (const bg of ['--color-paper', '--color-paper-2', '--color-paper-3', '--color-accent']) {
      const ratio = contrast(focus, root.getPropertyValue(bg));
      if (ratio < 3) failures.push(`focus on ${bg}: ${ratio.toFixed(2)}`);
    }
    return failures;
  });
  expect(await auditContrast()).toEqual([]);
  await page.locator('#torrent-file').setInputFiles({ name: 'hello.torrent', mimeType: 'application/x-bittorrent', buffer: Buffer.from(V1_FIXTURE, 'base64') });
  await expect(page.locator('#magnet-output')).toHaveValue(EXPECTED_MAGNET);
  expect(await auditContrast()).toEqual([]);
});
