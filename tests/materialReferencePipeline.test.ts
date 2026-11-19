import { describe, expect, it } from 'vitest';
import { normalizeMtl, mtlRefs, resolveCompanion } from '../src/core/fileSet';
describe('literal MTL filenames survive normalization and reference resolution', () => {
  for (const [statement, name] of [
    ["o'clock.png", "o'clock.png"], ['"o\'clock.png"', "o'clock.png"],
    ['"#tex.png"', '#tex.png'], ['"my # texture.png"', 'my # texture.png'],
    ['"\'leading.png"', "'leading.png"],
  ]) it(name + ' from ' + statement, () => {
    const text = `newmtl painted\nmap_Kd ${statement} # inline comment`;
    const normalized = normalizeMtl(text);
    const refs = mtlRefs(normalized);
    const file = { path: name, file: new File(['image'], name) };
    expect(refs).toHaveLength(1);
    expect(resolveCompanion(refs[0], '', [file])).toBe(file);
  });
  it('still rejects an unclosed opening quote', () => {
    expect(() => normalizeMtl('map_Kd "unclosed.png')).toThrow(/unclosed/i);
  });
});
