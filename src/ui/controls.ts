/** Keep range tracks filled up to the thumb. Programmatic `.value` writes do not fire `input`. */
export function syncRangeFill(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const span = max - min;
  const pct = span === 0 || !Number.isFinite(span) ? 0 : ((value - min) / span) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

export function bindRangeFills(root: ParentNode): void {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type=range]')) {
    syncRangeFill(input);
    input.addEventListener('input', () => syncRangeFill(input));
  }
}
