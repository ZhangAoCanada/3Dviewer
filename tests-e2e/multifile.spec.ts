import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4o6EBAAMQAS0ujiXaAAAAAElFTkSuQmCC',
  'base64',
);

function triangleBin(): Buffer {
  const bytes = Buffer.alloc(42);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setFloat32(12, 1, true);
  view.setFloat32(28, 1, true);
  view.setUint16(38, 1, true);
  view.setUint16(40, 2, true);
  return bytes;
}

function gltfJson(): string {
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ uri: 'tex.png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    buffers: [{ uri: 'scene.bin', byteLength: 42 }],
  });
}

const OBJ = ['mtllib model.mtl', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'usemtl mat', 'f 1/1 2/2 3/3', ''].join(
  '\n',
);
const MTL = ['newmtl mat', 'Kd 0.2 0.8 0.3', 'map_Kd tex.png', ''].join('\n');

function files() {
  return {
    gltf: { name: 'scene.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(gltfJson()) },
    bin: { name: 'scene.bin', mimeType: 'application/octet-stream', buffer: triangleBin() },
    png: { name: 'tex.png', mimeType: 'image/png', buffer: PNG },
    obj: { name: 'model.obj', mimeType: 'text/plain', buffer: Buffer.from(OBJ) },
    mtl: { name: 'model.mtl', mimeType: 'text/plain', buffer: Buffer.from(MTL) },
  };
}

async function ready(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { created: 0, revoked: 0 };
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = function (object: Blob | MediaSource) {
      state.created += 1;
      return create.call(URL, object);
    };
    URL.revokeObjectURL = function (url: string) {
      state.revoked += 1;
      return revoke.call(URL, url);
    };
    (window as unknown as { __blobUrls: typeof state }).__blobUrls = state;
  });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
}

async function toastText(page: Page): Promise<string> {
  return (await page.locator('#toast-msg').textContent()) ?? '';
}

async function blobCounts(page: Page): Promise<{ created: number; revoked: number }> {
  return page.evaluate(() => (window as unknown as { __blobUrls: { created: number; revoked: number } }).__blobUrls);
}

async function expectSettledBlobs(page: Page, created: boolean): Promise<void> {
  await expect.poll(async () => {
    const counts = await blobCounts(page);
    return counts.created === counts.revoked && (!created || counts.created > 0);
  }).toBe(true);
}

async function materials(page: Page): Promise<void> {
  const panel = page.locator('#panel');
  if (await panel.evaluate((node) => node.classList.contains('is-collapsed'))) {
    await page.click('#panel-btn');
  }
  await expect(page.locator('#scene-info')).toContainText('Materials');
}

test.beforeEach(async ({ page }) => {
  await ready(page);
});

test('a gltf with its bin and texture loads from the file picker', async ({ page }) => {
  const set = files();
  await page.locator('#file-input').setInputFiles([set.gltf, set.bin, set.png]);
  await expect(page.locator('#file-name')).toHaveText('scene.gltf', { timeout: 30_000 });
  await expect(page.locator('#hud-tris')).toHaveText('1');
  await materials(page);
  await expect(page.locator('#scene-info')).toContainText('From file');
  await expect.poll(() => toastText(page)).not.toContain('Loaded without');
  await expectSettledBlobs(page, true);
});

test('a gltf alone lists the missing files', async ({ page }) => {
  await page.locator('#file-input').setInputFiles(files().gltf);
  await expect(page.locator('#problem-title')).toHaveText('Files missing for this model');
  await expect(page.locator('#problem-desc')).toContainText('scene.bin');
  await expect(page.locator('#problem-desc')).toContainText('tex.png');
  await expect(page.locator('#problem-actions').getByRole('button', { name: 'Choose folder' })).toBeVisible();
});

test('an obj with its mtl and texture loads materials from the file', async ({ page }) => {
  const set = files();
  await page.locator('#file-input').setInputFiles([set.obj, set.mtl, set.png]);
  await expect(page.locator('#file-name')).toHaveText('model.obj', { timeout: 30_000 });
  await expect(page.locator('#hud-tris')).toHaveText('1');
  await materials(page);
  await expect(page.locator('#scene-info')).toContainText('From model.mtl');
  await expect.poll(() => toastText(page)).not.toContain('Materials not found');
  await expect.poll(() => toastText(page)).not.toContain('Loaded without');
  await expectSettledBlobs(page, true);
});

test('an obj without its mtl shows geometry and a warning', async ({ page }) => {
  await page.locator('#file-input').setInputFiles(files().obj);
  await expect(page.locator('#file-name')).toHaveText('model.obj', { timeout: 30_000 });
  await expect(page.locator('#hud-tris')).toHaveText('1');
  await expect(page.locator('#toast-msg')).toContainText('Materials not found: model.mtl. Showing geometry only.');
  await materials(page);
  await expect(page.locator('#scene-info')).toContainText('Missing model.mtl (geometry only)');
});

test('a folder picker opens the gltf scene', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'omniview-gltf-'));
  const set = files();
  try {
    await writeFile(join(dir, 'scene.gltf'), set.gltf.buffer);
    await writeFile(join(dir, 'scene.bin'), set.bin.buffer);
    await writeFile(join(dir, 'tex.png'), set.png.buffer);
    await page.locator('#folder-input').setInputFiles(dir);
    await expect(page.locator('#file-name')).toHaveText('scene.gltf', { timeout: 30_000 });
    await expect(page.locator('#hud-tris')).toHaveText('1');
    await materials(page);
    await expect(page.locator('#scene-info')).toContainText('From file');
    await expectSettledBlobs(page, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a file drop opens the gltf scene', async ({ page }) => {
  const set = files();
  const payload = [set.gltf, set.bin, set.png].map((file) => ({
    name: file.name,
    type: file.mimeType,
    bytes: [...file.buffer],
  }));
  await page.evaluate((dropped) => {
    const transfer = new DataTransfer();
    for (const file of dropped) {
      transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
    }
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, payload);
  await expect(page.locator('#file-name')).toHaveText('scene.gltf', { timeout: 30_000 });
  await expect(page.locator('#hud-tris')).toHaveText('1');
  await materials(page);
  await expect(page.locator('#scene-info')).toContainText('From file');
  await expectSettledBlobs(page, true);
});
