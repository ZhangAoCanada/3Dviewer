import type { RepresentationKind } from './types';

export interface SampleAsset {
  id: string;
  /** Menu label. */
  label: string;
  /** Short name on the start-screen card. */
  title: string;
  kind: RepresentationKind;
  /** Site-relative path, or an absolute URL when `remote` is set. */
  href: string;
  /** Download size. Omitted for a remote sample. */
  bytes?: number;
  /** Site-relative thumbnail. Omitted for a remote sample. */
  thumb?: string;
  remote?: boolean;
  flipY?: boolean;
  note?: string;
}

export const SAMPLES: readonly SampleAsset[] = [
  {
    id: 'torus-ply',
    label: '3DGS torus (.ply)',
    title: 'Torus',
    kind: 'splats',
    href: 'samples/torus.ply',
    bytes: 1_191_929,
    thumb: 'samples/thumbs/torus-ply.webp',
    note: 'Generated INRIA-style PLY',
  },
  {
    id: 'torus-splat',
    label: '3DGS torus (.splat)',
    title: 'Torus splat',
    kind: 'splats',
    href: 'samples/torus.splat',
    bytes: 153_600,
    thumb: 'samples/thumbs/torus-splat.webp',
    note: 'antimatter15 .splat layout',
  },
  {
    id: 'cloud',
    label: 'Point cloud (.ply)',
    title: 'Point cloud',
    kind: 'points',
    href: 'samples/cloud.ply',
    bytes: 360_179,
    thumb: 'samples/thumbs/cloud.webp',
    note: 'Binary little-endian XYZRGB',
  },
  {
    id: 'crate',
    label: 'Mesh crate (.glb)',
    title: 'Crate',
    kind: 'mesh',
    href: 'samples/crate.glb',
    bytes: 2_204,
    thumb: 'samples/thumbs/crate.webp',
  },
  {
    id: 'sphere',
    label: 'Mesh sphere (.obj)',
    title: 'Sphere',
    kind: 'mesh',
    href: 'samples/sphere.obj',
    bytes: 89_606,
    thumb: 'samples/thumbs/sphere.webp',
  },
  {
    id: 'butterfly',
    label: 'Butterfly (.spz, remote)',
    title: 'Butterfly',
    kind: 'splats',
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
