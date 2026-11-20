/** Small real binary Gaussian PLY with nonzero coefficients in all three SH bands. */
export function gaussianPlyFixture({ count = 8, little = true, degree = 3 }: { count?: number; little?: boolean; degree?: 0 | 1 | 2 | 3 | 4 } = {}): Buffer<ArrayBuffer> {
  const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', ...Array.from({ length: 3 * ((degree + 1) ** 2 - 1) }, (_, i) => `f_rest_${i}`), 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header = Buffer.from(['ply', `format binary_${little ? 'little' : 'big'}_endian 1.0`, `element vertex ${count}`, ...props.map((p) => `property float ${p}`), 'end_header', ''].join('\n'));
  const body = Buffer.alloc(count * props.length * 4);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j < props.length; j += 1) {
      const prop = props[j];
      const value = prop === 'x' ? i * 0.15 : prop === 'y' ? Math.sin(i) * 0.1 : prop === 'z' ? -1 : prop.startsWith('f_rest_') ? 0.125 + j / 128 : prop === 'rot_0' ? 1 : prop.startsWith('scale_') ? -3 : 0;
      view.setFloat32((i * props.length + j) * 4, value, little);
    }
  }
  return Buffer.concat([header, body]);
}
