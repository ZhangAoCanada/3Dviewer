export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString();
}

/** Compact counts for the stats pill: 999, 4.8K, 3.50M, 14.0M, 1.20B. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return String(Math.round(value));
  if (value < 1e6) return (value / 1e3).toFixed(value < 1e4 ? 1 : 0) + 'K';
  if (value < 1e9) return (value / 1e6).toFixed(value < 1e7 ? 2 : 1) + 'M';
  return (value / 1e9).toFixed(2) + 'B';
}

export function formatFixed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}
