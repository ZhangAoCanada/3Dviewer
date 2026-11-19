import { expect, test } from './test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
for (const [label, ref, name] of [
  ['bare apostrophe', "o'clock.png", "o'clock.png"],
  ['quoted apostrophe', '"o\'clock.png"', "o'clock.png"],
  ['quoted hash', '"#tex.png"', '#tex.png'],
  ['spaces and hash', '"my # texture.png"', 'my # texture.png'],
  ['leading apostrophe', '"\'leading.png"', "'leading.png"],
]) test(`complete local OBJ pipeline: ${label}`, async ({ page }) => {
  await page.addInitScript(() => {
    const created: { name: string; url: string }[] = [];
    Object.defineProperty(window, '__qaCreatedFiles', { value: created });
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = original(blob);
      if (blob instanceof File) created.push({ name: blob.name, url });
      return url;
    };
  });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    { name: 'model.obj', mimeType: 'text/plain', buffer: Buffer.from('mtllib model.mtl\nv -2 -2 0\nv 2 -2 0\nv 0 2 0\nvt 0 0\nvt 1 0\nvt 0.5 1\nusemtl painted\nf 1/1 2/2 3/3\n') },
    { name: 'model.mtl', mimeType: 'text/plain', buffer: Buffer.from(`newmtl painted\nKd 1 1 1\nmap_Kd ${ref} # comment\n`) },
    { name, mimeType: 'image/png', buffer: await readFile('tests-e2e/fixtures/material-paths/a/tex.png') },
  ]);
  await expect(page.locator('#file-name')).toHaveText('model.obj');
  await expect(page.locator('#scene-info')).not.toContainText(/missing|not found/i);
  const created: { name: string; url: string }[] = await page.evaluate(() => Reflect.get(window, '__qaCreatedFiles'));
  expect(created.map((entry) => entry.name)).toContain(name);
  await page.locator('#panel-btn').click(); await page.selectOption('#shading', 'flat');
  await expect.poll(async () => {
    const { data, info } = await sharp(await page.locator('#view').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let red = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i] > 200 && data[i + 1] < 50 && data[i + 2] < 50) red += 1;
    return red;
  }).toBeGreaterThan(100);
});
