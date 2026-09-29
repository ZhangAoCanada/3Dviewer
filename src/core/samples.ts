export interface SampleAsset {
  id: string;
  label: string;
  /** Site-relative path, or an absolute URL when `remote` is set. */
  href: string;
  remote?: boolean;
  flipY?: boolean;
  note?: string;
}

export const SAMPLES: readonly SampleAsset[] = [
  { id: 'torus-ply', label: '3DGS torus (.ply)', href: 'samples/torus.ply', note: 'Generated INRIA-style PLY' },
  { id: 'torus-splat', label: '3DGS torus (.splat)', href: 'samples/torus.splat', note: 'antimatter15 .splat layout' },
  { id: 'cloud', label: 'Point cloud (.ply)', href: 'samples/cloud.ply', note: 'Binary little-endian XYZRGB' },
  { id: 'crate', label: 'Mesh crate (.glb)', href: 'samples/crate.glb' },
  { id: 'sphere', label: 'Mesh sphere (.obj)', href: 'samples/sphere.obj' },
  {
    id: 'butterfly',
    label: 'Butterfly (.spz, remote)',
    href: 'https://sparkjs.dev/assets/splats/butterfly.spz',
    remote: true,
    flipY: true,
    note: 'Public Spark sample',
  },
];

export function sampleUrl(sample: SampleAsset, baseUrl: string): string {
  if (sample.remote || /^https?:\/\//i.test(sample.href)) return sample.href;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${sample.href}`;
}
