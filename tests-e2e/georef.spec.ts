import { expect, test, type Page } from '@playwright/test';

const PROPS = [
  'x',
  'y',
  'z',
  'f_dc_0',
  'f_dc_1',
  'f_dc_2',
  'opacity',
  'scale_0',
  'scale_1',
  'scale_2',
  'rot_0',
  'rot_1',
  'rot_2',
  'rot_3',
];

const OFFSET = [
  'offsetx 539022.51',
  'offsety 3377206.74',
  'offsetz 22.95',
  'minx 1',
  'miny 2',
  'minz 3',
  'maxx 4',
  'maxy 5',
  'maxz 6',
];

function gaussianPly(comments: string[]): Buffer {
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    ...comments.map((comment) => `comment ${comment}`),
    'element vertex 1',
    ...PROPS.map((name) => `property float ${name}`),
    'end_header',
    '',
  ].join('\n');
  const body = Buffer.alloc(PROPS.length * 4);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  view.setFloat32(0, 1, true);
  view.setFloat32(4, 2, true);
  view.setFloat32(8, 3, true);
  view.setFloat32(10 * 4, 1, true);
  return Buffer.concat([Buffer.from(header), body]);
}

async function openPly(page: Page, name: string, comments: string[]): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await page.locator('#file-input').setInputFiles({
    name,
    mimeType: 'application/octet-stream',
    buffer: gaussianPly(comments),
  });
  await expect(page.locator('#file-name')).toHaveText(name, { timeout: 30_000 });
  await expect(page.locator('#loading')).toBeHidden();
}

test('epsg 0 hides the chip and epsg.io link but keeps the offset', async ({ page }) => {
  await openPly(page, 'local.ply', [...OFFSET, 'epsg 0']);
  await expect(page.locator('#file-chip')).toBeVisible();
  await expect(page.locator('#geo-badge')).toBeHidden();
  await expect(page.locator('#file-chip')).not.toContainText('EPSG');
  await page.click('#panel-btn');
  const geo = page.locator('#sec-geo');
  await expect(geo).toBeVisible();
  await expect(geo).toContainText('539022.51');
  await expect(geo).toContainText('1 2 3');
  await expect(geo).not.toContainText('EPSG');
  await expect(page.locator('#geo-epsg-link')).toBeHidden();
  await expect(page.locator('#geo-epsg-link')).not.toHaveAttribute('href', /epsg\.io/);
});

test('a positive EPSG code links to epsg.io', async ({ page }) => {
  await openPly(page, 'projected.ply', [...OFFSET, 'epsg 4326']);
  await expect(page.locator('#geo-badge')).toBeVisible();
  await expect(page.locator('#geo-badge-text')).toHaveText('EPSG:4326');
  await page.click('#panel-btn');
  await expect(page.locator('#geo-info')).toContainText('EPSG:4326');
  await expect(page.locator('#geo-info')).toContainText('3377206.74');
  const link = page.locator('#geo-epsg-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://epsg.io/4326');
});
