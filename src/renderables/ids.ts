let seq = 0;

export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}
