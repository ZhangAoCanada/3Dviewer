import { describe, expect, it } from 'vitest';
import { epsgCode, presentEpsg } from '../src/core/epsg';

const hidden = { code: null, badge: null, crs: null, href: null };

describe('epsgCode', () => {
  it('accepts a positive integer code', () => {
    expect(epsgCode(4326)).toBe('4326');
    expect(epsgCode('4547')).toBe('4547');
    expect(epsgCode('EPSG:32650')).toBe('32650');
    expect(epsgCode(' epsg:4326 ')).toBe('4326');
    expect(epsgCode('0004326')).toBe('4326');
  });

  it('treats 0, missing, NaN, and non-positive values as unknown', () => {
    const unknown = [
      0,
      -1,
      -4326,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      null,
      undefined,
      '',
      '   ',
      '0',
      '00',
      'EPSG:0',
      'epsg:0',
      'NaN',
      'nan',
      '-5',
      '0.0',
      '+0',
    ];
    for (const raw of unknown) expect(epsgCode(raw)).toBeNull();
  });
});

describe('presentEpsg', () => {
  it('shows the chip, CRS row, and epsg.io link for a valid code', () => {
    expect(presentEpsg('EPSG:4326')).toEqual({
      code: '4326',
      badge: 'EPSG:4326',
      crs: 'EPSG:4326',
      href: 'https://epsg.io/4326',
    });
    expect(presentEpsg(4547).href).toBe('https://epsg.io/4547');
  });

  it('hides the chip, CRS row, and link when the code is unknown', () => {
    expect(presentEpsg(0)).toEqual(hidden);
    expect(presentEpsg('0')).toEqual(hidden);
    expect(presentEpsg(undefined)).toEqual(hidden);
    expect(presentEpsg(null)).toEqual(hidden);
    expect(presentEpsg(Number.NaN)).toEqual(hidden);
    expect(presentEpsg('NaN')).toEqual(hidden);
    expect(presentEpsg(-1)).toEqual(hidden);
    expect(presentEpsg('EPSG:0')).toEqual(hidden);
    expect(presentEpsg('')).toEqual(hidden);
  });
});
