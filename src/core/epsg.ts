/**
 * A real EPSG code is a positive integer. Zero, a missing value, NaN, and any
 * non-positive number mean the file has no coordinate reference system.
 */
export function epsgCode(raw: unknown): string | null {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw <= 0) return null;
    return String(raw);
  }
  if (typeof raw !== 'string') return null;
  const stripped = raw.trim().replace(/^EPSG:/i, '').trim();
  if (!/^\d+$/.test(stripped)) return null;
  const code = Number(stripped);
  if (!Number.isSafeInteger(code) || code <= 0) return null;
  return String(code);
}

export interface EpsgPresentation {
  /** Canonical positive code, or null when the CRS is unknown. */
  code: string | null;
  /** File-chip text, or null when the chip should stay hidden. */
  badge: string | null;
  /** Georeference CRS row, or null when that row should be omitted. */
  crs: string | null;
  /** epsg.io URL, or null when the link should stay hidden. */
  href: string | null;
}

/** Chip, CRS row, and epsg.io link for a parsed code. Unknown codes hide all three. */
export function presentEpsg(raw: unknown): EpsgPresentation {
  const code = epsgCode(raw);
  if (!code) return { code: null, badge: null, crs: null, href: null };
  const label = `EPSG:${code}`;
  return { code, badge: label, crs: label, href: `https://epsg.io/${code}` };
}
